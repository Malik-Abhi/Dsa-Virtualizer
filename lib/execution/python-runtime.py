"""Bounded educational Python runner, shared by the browser worker and tests."""
import ast
import json
import math
import sys
import time
import types


class VisualizationLimit(Exception):
    pass


class UnsupportedPython(Exception):
    def __init__(self, message, line=1):
        super().__init__(message)
        self.line = line


ALLOWED_NODES = {
    'Module', 'Expr', 'Assign', 'AnnAssign', 'AugAssign', 'Name', 'Constant',
    'List', 'Tuple', 'Dict', 'Set', 'BinOp', 'UnaryOp', 'BoolOp', 'Compare',
    'If', 'IfExp', 'For', 'While', 'Break', 'Continue', 'Pass', 'FunctionDef',
    'arguments', 'arg', 'Return', 'Call', 'keyword', 'Attribute', 'Subscript',
    'Slice', 'Load', 'Store', 'Add', 'Sub', 'Mult', 'Div', 'FloorDiv', 'Mod',
    'Pow', 'UAdd', 'USub', 'Not', 'And', 'Or', 'Eq', 'NotEq', 'Lt', 'LtE',
    'Gt', 'GtE', 'Is', 'IsNot', 'In', 'NotIn', 'JoinedStr', 'FormattedValue',
    'ListComp', 'SetComp', 'DictComp', 'comprehension', 'BitAnd', 'BitOr',
    'BitXor', 'LShift', 'RShift', 'Invert', 'ClassDef',
}
ALLOWED_METHODS = {
    'append', 'extend', 'insert', 'pop', 'remove', 'clear', 'reverse', 'sort',
    'copy', 'count', 'index', 'get', 'keys', 'values', 'items', 'update',
    'setdefault', 'add', 'discard', 'union', 'intersection', 'difference',
    'split', 'join', 'strip', 'lstrip', 'rstrip', 'lower', 'upper', 'replace',
    'startswith', 'endswith', 'find', 'isdigit', 'isalpha',
}


def validate_python(tree):
    constructors = {id(member) for node in ast.walk(tree) if isinstance(node, ast.ClassDef) for member in node.body if isinstance(member, ast.FunctionDef) and member.name == '__init__'}
    for node in ast.walk(tree):
        line = getattr(node, 'lineno', 1)
        if type(node).__name__ not in ALLOWED_NODES:
            raise UnsupportedPython(f'{type(node).__name__} is not supported in the visualizer.', line)
        if isinstance(node, (ast.Name, ast.arg)) and ((node.id if isinstance(node, ast.Name) else node.arg).startswith('__') or (node.id if isinstance(node, ast.Name) else node.arg).startswith('_viz_')):
            raise UnsupportedPython('Runtime internals are not accessible.', line)
        if isinstance(node, ast.Attribute) and (node.attr.startswith('__') or node.attr.startswith('_viz_')):
            raise UnsupportedPython('Runtime internals are not accessible.', line)
        if isinstance(node, ast.FunctionDef) and (node.decorator_list or node.name.startswith('_viz_') or node.name.startswith('__') and id(node) not in constructors):
            raise UnsupportedPython('Decorators and reserved function names are not supported.', line)
        if isinstance(node, ast.ClassDef):
            if node.bases or node.keywords or node.decorator_list:
                raise UnsupportedPython('Class inheritance, metaclasses, and decorators are not supported.', line)
            if node.name.startswith('__') or node.name.startswith('_viz_'):
                raise UnsupportedPython('Reserved class names are not supported.', line)
            if any(not isinstance(member, (ast.FunctionDef, ast.Assign, ast.AnnAssign, ast.Pass)) and not (isinstance(member, ast.Expr) and isinstance(member.value, ast.Constant) and isinstance(member.value.value, str)) for member in node.body):
                raise UnsupportedPython('Class bodies support methods, fields, and docstrings.', line)
        if isinstance(node, ast.Constant) and not isinstance(node.value, (str, int, float, bool, type(None))):
            raise UnsupportedPython('Only strings, numbers, booleans, and None are supported literals.', line)
        if isinstance(node, ast.comprehension) and node.is_async:
            raise UnsupportedPython('Async comprehensions are not supported.', line)


class InstrumentPython(ast.NodeTransformer):
    def visit_FunctionDef(self, node):
        # Type hints describe input types; they are not algorithm operations.
        node.returns = None
        for argument in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs, *([node.args.vararg] if node.args.vararg else []), *([node.args.kwarg] if node.args.kwarg else [])]:
            argument.annotation = None
        return self.generic_visit(node)

    def visit_AnnAssign(self, node):
        node.annotation = ast.Constant(None)
        if node.value is not None:
            node.value = self.assignment_value(node.value, [node.target], node.lineno)
            node.target = self.visit(node.target)
            return node
        return self.generic_visit(node)

    def assignment_value(self, value, targets, line, augmented=False):
        key = f'assignment:{line}:{value.col_offset}'
        class Operands(ast.NodeTransformer):
            def visit(self, item):
                if isinstance(item, (ast.BinOp, ast.BoolOp, ast.UnaryOp)):
                    return self.generic_visit(item)
                if not isinstance(item, ast.expr):
                    return item
                label = ast.unparse(item)
                return ast.copy_location(ast.Call(ast.Name('_viz_operand', ast.Load()), [item, ast.Constant(label), ast.Constant(key)], []), item)
        evaluated = self.visit(Operands().visit(value))
        begin = ast.Call(ast.Name('_viz_begin_condition', ast.Load()), [ast.Constant(key)], [])
        evaluated = ast.Subscript(ast.Tuple([begin, evaluated], ast.Load()), ast.Constant(1), ast.Load())
        labels = ast.List([ast.Constant(ast.unparse(target)) for target in targets], ast.Load())
        return ast.copy_location(ast.Call(ast.Name('_viz_assignment', ast.Load()), [evaluated, ast.Constant(line), labels, ast.Constant(augmented)], []), value)

    def visit_Assign(self, node):
        node.value = self.assignment_value(node.value, node.targets, node.lineno)
        node.targets = [self.visit(target) for target in node.targets]
        return node

    def visit_AugAssign(self, node):
        node.value = self.assignment_value(node.value, [node.target], node.lineno, True)
        node.target = self.visit(node.target)
        return node

    def visit_Attribute(self, node):
        self.generic_visit(node)
        if isinstance(node.ctx, ast.Load):
            return ast.copy_location(ast.Call(ast.Name('_viz_attribute', ast.Load()), [node.value, ast.Constant(node.attr)], []), node)
        node.value = ast.copy_location(ast.Call(ast.Name('_viz_instance', ast.Load()), [node.value, ast.Constant(node.attr)], []), node.value)
        return node

    def condition_test(self, test, line):
        key = f'{line}:{test.col_offset}'
        class Operands(ast.NodeTransformer):
            def visit_Compare(self, comparison):
                def wrap(value):
                    label = ast.unparse(value)
                    return ast.copy_location(ast.Call(ast.Name('_viz_operand', ast.Load()), [value, ast.Constant(label), ast.Constant(key)], []), value)
                comparison.left = wrap(comparison.left)
                comparison.comparators = [wrap(value) for value in comparison.comparators]
                return comparison
        if any(isinstance(item, ast.Compare) for item in ast.walk(test)):
            test = Operands().visit(test)
        else:
            label = ast.unparse(test)
            test = ast.copy_location(ast.Call(ast.Name('_viz_operand', ast.Load()), [test, ast.Constant(label), ast.Constant(key)], []), test)
        test = self.visit(test)
        begin = ast.Call(ast.Name('_viz_begin_condition', ast.Load()), [ast.Constant(key)], [])
        evaluated = ast.Subscript(ast.Tuple([begin, test], ast.Load()), ast.Constant(1), ast.Load())
        return ast.copy_location(ast.Call(ast.Name('_viz_condition', ast.Load()), [evaluated, ast.Constant(line), ast.Constant(key)], []), test)

    def visit_If(self, node):
        node.test = self.condition_test(node.test, node.lineno)
        node.body = [replacement for statement in node.body for replacement in self.statement(statement)]
        node.orelse = [replacement for statement in node.orelse for replacement in self.statement(statement)]
        return node

    def statement(self, node):
        result = self.visit(node)
        return result if isinstance(result, list) else [result]

    def instrument_loop(self, node, kind):
        condition = ast.unparse(node.test) if isinstance(node, ast.While) else f'{ast.unparse(node.target)} in {ast.unparse(node.iter)}'
        names = sorted({item.id for item in ast.walk(node.target if isinstance(node, ast.For) else node) if isinstance(item, ast.Name) and (not isinstance(node, ast.For) or isinstance(item.ctx, ast.Store))})
        if isinstance(node, ast.While):
            node.test = self.condition_test(node.test, node.lineno)
            node.body = [replacement for statement in node.body for replacement in self.statement(statement)]
            node.orelse = [replacement for statement in node.orelse for replacement in self.statement(statement)]
        else:
            self.generic_visit(node)
        enter = ast.Expr(ast.Call(ast.Name('_viz_loop_enter', ast.Load()), [ast.Constant(kind), ast.Constant(node.lineno), ast.Constant(condition), ast.List([ast.Constant(name) for name in names], ast.Load())], []))
        iteration = ast.Expr(ast.Call(ast.Name('_viz_loop_iteration', ast.Load()), [], []))
        node.body.insert(0, ast.copy_location(iteration, node))
        if isinstance(node, ast.For):
            exhausted = ast.Expr(ast.Call(ast.Name('_viz_loop_exhausted', ast.Load()), [], []))
            node.orelse.insert(0, ast.copy_location(exhausted, node))
        leave = ast.Expr(ast.Call(ast.Name('_viz_loop_exit', ast.Load()), [], []))
        wrapped = ast.Try(body=[node], handlers=[], orelse=[], finalbody=[ast.copy_location(leave, node)])
        return [ast.copy_location(enter, node), ast.copy_location(wrapped, node)]

    def visit_While(self, node):
        return self.instrument_loop(node, 'while')

    def visit_For(self, node):
        return self.instrument_loop(node, 'for')

    def visit_Subscript(self, node):
        self.generic_visit(node)
        if isinstance(node.ctx, ast.Load) and not isinstance(node.slice, ast.Slice):
            pointer = node.slice.id if isinstance(node.slice, ast.Name) else node.slice.left.id if isinstance(node.slice, ast.BinOp) and isinstance(node.slice.left, ast.Name) else ''
            return ast.copy_location(ast.Call(ast.Name('_viz_read', ast.Load()), [node.value, node.slice, ast.Constant(pointer)], []), node)
        if isinstance(node.ctx, ast.Store) and isinstance(node.slice, ast.Name):
            node.value = ast.copy_location(ast.Call(ast.Name('_viz_target', ast.Load()), [node.value, ast.Constant(node.slice.id)], []), node.value)
        return node


def execute_python(source):
    started = time.perf_counter()
    steps, output, active = [], [], []
    loop_states, loop_sequence = [], 0
    user_classes = set()
    condition_collectors = []
    assignment_annotations = {}
    stdout = ''
    lines = source.splitlines()
    filename = '<algorithm.py>'
    objects, identities, frame_ids = {}, {}, {}
    accesses, associations, pending = [], {}, {}
    previous_variables, previous_heap = {}, {}
    operation_count, byte_count, sequence = 0, 0, 0
    latest_line = 1
    last_return, has_returned = None, False
    exception_line = None

    def identity(value):
        address = id(value)
        if address not in identities:
            identities[address] = f'h{len(identities) + 1}'
            # Retain objects so CPython cannot reuse an address within a timeline.
            objects[address] = value
        return identities[address]

    def encode(value, queue, queued):
        if value is None:
            return {'kind': 'primitive', 'type': 'none', 'value': None}
        if isinstance(value, bool):
            return {'kind': 'primitive', 'type': 'python-boolean', 'value': value}
        if isinstance(value, (int, float)):
            number = value if abs(value) <= 9007199254740991 and (isinstance(value, int) or math.isfinite(value)) else str(value)
            return {'kind': 'primitive', 'type': 'number', 'value': number}
        if isinstance(value, str):
            if len(value) > 100000:
                raise VisualizationLimit('String size limit (100,000 characters) reached.')
            return {'kind': 'primitive', 'type': 'string', 'value': value}
        if not isinstance(value, (list, tuple, dict, set, types.FunctionType, types.MethodType)) and type(value) not in user_classes and not (isinstance(value, type) and value in user_classes):
            return {'kind': 'primitive', 'type': 'string', 'value': repr(value)}
        object_id = identity(value)
        if object_id not in queued:
            queued.add(object_id)
            queue.append(value)
        return {'kind': 'reference', 'objectId': object_id}

    def visible(frame):
        return {name: value for name, value in frame.f_locals.items() if not name.startswith('_viz_') and not name.startswith('__')}

    def capture(event, line, description, result=None, returning=False, force=False, operands=None, assignment_operands=None):
        nonlocal previous_variables, previous_heap, byte_count
        if len(steps) >= 2500:
            raise VisualizationLimit('Execution exceeded 2,500 snapshots. Reduce the input.')
        queue, queued, heap, frames, current_variables = [], set(), [], [], {}
        for index, frame in enumerate(active):
            frame_id = frame_ids[frame]
            is_global = frame.f_code.co_name == '<module>'
            is_active = index == len(active) - 1
            returned = returning and is_active or event == 'complete' and is_global and has_returned
            variables = []
            for name, value in visible(frame).items():
                value = encode(value, queue, queued)
                binding_id = f'{frame_id}:{name}'
                current_variables[binding_id] = value
                variables.append({'id': binding_id, 'name': name, 'value': value, 'changed': previous_variables.get(binding_id) != value})
            frames.append({
                'id': frame_id, 'name': 'Global frame' if is_global else frame.f_code.co_name,
                'kind': 'global' if is_global else 'function',
                'status': 'complete' if event == 'complete' else 'returning' if returned else 'active' if is_active else 'suspended',
                'callLine': frame.f_back.f_lineno if not is_global and frame.f_back else 1,
                'variables': variables, 'returnValue': encode(result if returning else last_return if returned else None, queue, queued),
                'returned': bool(returned),
            })
        loops = []
        for state in loop_states:
            variables = []
            for name, value in visible(state['frame']).items():
                if name not in state['names']:
                    continue
                binding_id = f"{state['frameId']}:{name}"
                encoded = encode(value, queue, queued)
                variables.append({'id': binding_id, 'name': name, 'value': encoded, 'changed': previous_variables.get(binding_id) != encoded})
            loops.append({key: value for key, value in state.items() if key not in ('frame', 'names')})
            loops[-1]['variables'] = variables
        cursor = 0
        while cursor < len(queue):
            if cursor >= 1000:
                raise VisualizationLimit('Memory graph exceeds 1,000 reachable objects.')
            value = queue[cursor]
            cursor += 1
            object_id = identity(value)
            entries = {}
            if isinstance(value, (types.FunctionType, types.MethodType)):
                if isinstance(value, types.MethodType):
                    value = value.__func__
                obj = {'id': object_id, 'kind': 'function', 'name': value.__name__, 'parameters': list(value.__code__.co_varnames[:value.__code__.co_argcount]), 'line': value.__code__.co_firstlineno}
            elif type(value) in user_classes or isinstance(value, type) and value in user_classes:
                fields = {name: field for name, field in vars(value).items() if not name.startswith('__') and not name.startswith('_viz_')}
                if len(fields) > 1000:
                    raise VisualizationLimit('Object property limit (1,000) reached.')
                properties = [{'name': name, 'value': encode(field, queue, queued)} for name, field in fields.items()]
                obj = {'id': object_id, 'kind': 'object', 'properties': properties}
                entries = {p['name']: p['value'] for p in properties}
            elif isinstance(value, dict):
                if len(value) > 1000:
                    raise VisualizationLimit('Object property limit (1,000) reached.')
                properties = [{'name': str(k), 'value': encode(v, queue, queued)} for k, v in value.items()]
                obj = {'id': object_id, 'kind': 'object', 'properties': properties}
                entries = {p['name']: p['value'] for p in properties}
            else:
                if len(value) > 1000:
                    raise VisualizationLimit('Array size limit (1,000) reached.')
                items = [encode(v, queue, queued) for v in value]
                obj = {'id': object_id, 'kind': 'array', 'items': items}
                entries = {str(i): v for i, v in enumerate(items)}
            prior = previous_heap.get(object_id, {})
            obj['changedKeys'] = [key for key in dict.fromkeys([*prior, *entries]) if prior.get(key) != entries.get(key)]
            heap.append(obj)
        heap_lookup = {o['id']: o for o in heap}
        pointers = []
        for frame in frames:
            for variable in frame['variables']:
                for object_id in associations.get(variable['id'], {}):
                    obj, value = heap_lookup.get(object_id), variable['value']
                    if obj and obj['kind'] == 'array' and value['kind'] == 'primitive' and value['type'] == 'number' and isinstance(value['value'], int) and 0 <= value['value'] < len(obj['items']):
                        pointers.append({'id': f"{variable['id']}:{object_id}", 'name': variable['name'], 'frameId': frame['id'], 'objectId': object_id, 'index': value['value']})
        changed = [key for key, value in current_variables.items() if previous_variables.get(key) != value]
        heap_changed = any(obj['changedKeys'] for obj in heap)
        if not force and not changed and not heap_changed and not accesses:
            return
        memory = {'frames': frames, 'loops': loops, 'heap': heap, 'accesses': list(accesses), 'pointers': pointers}
        legacy = {variable['name']: variable['value'].get('value', f"reference #{variable['value'].get('objectId', '')}") for frame in frames for variable in frame['variables']}
        step = {'step': len(steps) + 1, 'line': max(1, line), 'event': event, 'memory': memory, 'variables': legacy,
                'dataStructures': [], 'output': list(output), 'changedElements': changed, 'accessedElements': [],
                'callStack': [{'name': f['name'], 'line': f['callLine']} for f in frames if f['kind'] == 'function'], 'description': description}
        if operands:
            step['conditionOperands'] = operands
        if assignment_operands:
            step['assignmentOperands'] = assignment_operands
        if returning:
            step['returnValue'] = repr(result)
        size = len(json.dumps(step, ensure_ascii=False).encode('utf-8'))
        if byte_count + size > 8_000_000:
            raise VisualizationLimit('Timeline exceeded 8 MB. Reduce the input.')
        byte_count += size
        steps.append(step)
        accesses.clear()
        previous_variables = current_variables
        previous_heap = {o['id']: {str(i): v for i, v in enumerate(o['items'])} if o['kind'] == 'array' else {p['name']: p['value'] for p in o['properties']} if o['kind'] == 'object' else {} for o in heap}

    def source_line(line):
        return lines[line - 1].strip() if 0 < line <= len(lines) else ''

    def flush(frame):
        line = pending.pop(frame, None)
        annotation = assignment_annotations.pop(frame, None)
        if line is None and annotation:
            line = annotation['line']
        if line is not None:
            operands = annotation['values'] if annotation and annotation['line'] == line else None
            if annotation and annotation['augmented']:
                for name in annotation['targets']:
                    if name in frame.f_locals:
                        operands.append({'expression': name, 'value': repr(frame.f_locals[name])[:500]})
            capture('assignment', line, source_line(line), force=bool(operands), assignment_operands=operands)

    def trace(frame, event, arg):
        nonlocal sequence, latest_line, operation_count, last_return, has_returned, exception_line
        if frame.f_code.co_filename != filename:
            return None
        latest_line = frame.f_lineno
        if event == 'opcode':
            operation_count += 1
            if operation_count > 100000:
                raise VisualizationLimit('Execution exceeded 100,000 operations. Check your loop condition.')
            return trace
        if event == 'call':
            frame.f_trace_opcodes = True
            # Class-body code is a namespace builder, not a function invocation.
            if frame.f_code.co_name != '<module>' and not frame.f_code.co_flags & 2:
                return trace
            # Comprehensions still count operations but are not function call frames.
            if frame.f_code.co_name.startswith('<') and frame.f_code.co_name != '<module>':
                return trace
            if frame.f_code.co_name == '<module>':
                frame_ids[frame] = 'global'
            else:
                if len(active) >= 60:
                    raise VisualizationLimit('Execution exceeded 60 call frames.')
                if active:
                    flush(active[-1])
                sequence += 1
                frame_ids[frame] = f'call-{sequence}'
            active.append(frame)
            if frame.f_code.co_name != '<module>':
                capture('call', frame.f_back.f_lineno, f'Call {frame.f_code.co_name}', force=True)
        elif frame in frame_ids:
            if event == 'line':
                flush(frame)
                pending[frame] = frame.f_lineno
            elif event == 'exception':
                exception_line = exception_line or frame.f_lineno
            elif event == 'return' and exception_line is None:
                flush(frame)
                if frame.f_code.co_name != '<module>':
                    has_returned, last_return = True, arg
                    capture('return', frame.f_lineno, f'Return {repr(arg)[:120]}', arg, True, True)
                    active.pop()
        return trace

    def user_frame():
        frame = sys._getframe(1)
        while frame and frame.f_code.co_filename != filename:
            frame = frame.f_back
        return frame

    def record_access(value, key, pointer, frame):
        if isinstance(value, (list, tuple, dict)):
            object_id = identity(value)
            normalized = key + len(value) if isinstance(value, (list, tuple)) and isinstance(key, int) and key < 0 else key
            accesses.append({'objectId': object_id, 'property': str(normalized), 'frameId': frame_ids.get(frame, 'global')})
            if isinstance(value, (list, tuple)) and pointer:
                owner = frame if pointer in frame.f_locals else active[0]
                associations.setdefault(f'{frame_ids.get(owner, "global")}:{pointer}', {})[object_id] = True

    def read(value, key, pointer):
        result = value[key]
        record_access(value, key, pointer, user_frame())
        return result

    def target(value, pointer):
        frame = user_frame()
        key = frame.f_locals.get(pointer, frame.f_globals.get(pointer))
        record_access(value, key, pointer, frame)
        return value

    def begin_condition(key):
        condition_collectors.append({'key': key, 'values': []})

    def operand(value, label, key):
        collector = next(item for item in reversed(condition_collectors) if item['key'] == key)
        collector['values'].append({'expression': label, 'value': repr(value)[:500]})
        return value

    def assignment(value, line, targets, augmented):
        collector = condition_collectors.pop()
        values = collector['values']
        if not augmented:
            values.extend({'expression': label, 'value': repr(value)[:500]} for label in targets)
        assignment_annotations[user_frame()] = {'line': line, 'values': values, 'targets': targets, 'augmented': augmented}
        return value

    def condition(value, line, key):
        collector = condition_collectors.pop()
        frame = user_frame()
        # The line event belongs to this condition; record the evaluated boolean.
        pending.pop(frame, None)
        for state in reversed(loop_states):
            if state['frame'] is frame and state['line'] == line:
                state['conditionResult'] = bool(value)
                state['status'] = 'checking' if value else 'complete'
                break
        capture('condition', line, f'{source_line(line)} → {bool(value)}', force=True, operands=collector['values'])
        return value

    def loop_enter(kind, line, condition_text, names):
        nonlocal loop_sequence
        frame = user_frame()
        pending.pop(frame, None)
        loop_sequence += 1
        parent = next((state['id'] for state in reversed(loop_states) if state['frame'] is frame), None)
        state = {'id': f'loop-{loop_sequence}', 'frameId': frame_ids[frame], 'kind': kind, 'line': line,
                 'condition': condition_text, 'iteration': 0, 'conditionResult': None, 'status': 'checking', 'frame': frame, 'names': names}
        if parent:
            state['parentId'] = parent
        loop_states.append(state)
        capture('condition', line, f'Enter {kind} loop', force=True)

    def loop_iteration():
        frame = user_frame()
        pending.pop(frame, None)
        state = next(state for state in reversed(loop_states) if state['frame'] is frame)
        state['iteration'] += 1
        state['status'] = 'running'
        if state['kind'] == 'for':
            state['conditionResult'] = True
        capture('condition', state['line'], f"{state['kind']} loop · iteration {state['iteration']}", force=True)

    def loop_exhausted():
        loop_states[-1]['conditionResult'] = False

    def loop_exit():
        state = loop_states[-1]
        # Preserve the final body assignment before removing this loop block.
        if sys.exc_info()[0] is None:
            flush(state['frame'])
            state['status'] = 'complete'
            capture('condition', state['line'], f"Loop finished after {state['iteration']} iterations", force=True)
        loop_states.pop()

    def build_class(body, name, *bases, **keywords):
        cls = __import__('builtins').__build_class__(body, name, *bases, **keywords)
        user_classes.add(cls)
        return cls

    def instance(value, name):
        if name.startswith('__') or name.startswith('_viz_') or not (type(value) in user_classes or isinstance(value, type) and value in user_classes):
            raise UnsupportedPython(f'Attribute “{name}” is not supported on this value.', user_frame().f_lineno)
        return value

    def attribute(value, name):
        if type(value) in user_classes or isinstance(value, type) and value in user_classes:
            instance(value, name)
            fields = vars(value)
            methods = vars(type(value)) if type(value) in user_classes else {}
            if name not in fields and name not in methods:
                raise AttributeError(f'{type(value).__name__} has no attribute {name}')
            return getattr(value, name)
        if name in ALLOWED_METHODS and isinstance(value, (list, tuple, dict, set, str)):
            return getattr(value, name)
        raise UnsupportedPython(f'Attribute “{name}” is not supported on this value.', user_frame().f_lineno)

    def printed(*values, sep=' ', end='\n'):
        nonlocal stdout
        if not isinstance(sep, str) or not isinstance(end, str):
            raise TypeError('sep and end must be strings')
        message = sep.join(str(v) for v in values) + end
        if len(stdout) + len(message) > 100000:
            raise VisualizationLimit('Console output exceeded 100,000 characters.')
        # Preserve print output, including custom separators and multiline strings.
        stdout += message
        output[:] = stdout.removesuffix('\n').split('\n') if stdout else []
        frame = user_frame()
        pending.pop(frame, None)
        capture('output', frame.f_lineno, 'Print output', force=True)

    safe_builtins = {name: getattr(__import__('builtins'), name) for name in (
        'len', 'range', 'list', 'tuple', 'dict', 'set', 'int', 'float', 'str', 'bool',
        'enumerate', 'zip', 'min', 'max', 'sum', 'abs', 'sorted', 'reversed',
        'all', 'any', 'round', 'pow',
    )}
    safe_builtins['print'] = printed
    safe_builtins['__build_class__'] = build_class
    namespace = {'__builtins__': safe_builtins, '__name__': 'algorithm', '_viz_attribute': attribute, '_viz_instance': instance, '_viz_read': read, '_viz_target': target, '_viz_condition': condition, '_viz_operand': operand, '_viz_assignment': assignment, '_viz_begin_condition': begin_condition, '_viz_loop_enter': loop_enter, '_viz_loop_iteration': loop_iteration, '_viz_loop_exit': loop_exit, '_viz_loop_exhausted': loop_exhausted}
    error = None
    try:
        if len(source) > 30000:
            raise VisualizationLimit('Source exceeds 30,000 characters.')
        tree = ast.parse(source, filename)
        validate_python(tree)
        tree = ast.fix_missing_locations(InstrumentPython().visit(tree))
        code = compile(tree, filename, 'exec')
        sys.settrace(trace)
        exec(code, namespace, namespace)
        sys.settrace(None)
        if active:
            capture('complete', max(1, len(lines)), 'Execution complete. All operations have been recorded.', force=True)
    except Exception as exc:
        sys.settrace(None)
        line = getattr(exc, 'lineno', None) or getattr(exc, 'line', None) or exception_line or latest_line
        kind = 'syntax' if isinstance(exc, SyntaxError) else 'unsupported' if isinstance(exc, UnsupportedPython) else 'limit' if isinstance(exc, (VisualizationLimit, RecursionError, MemoryError)) else 'runtime'
        error = {'kind': kind, 'line': max(1, line), 'message': str(exc) or type(exc).__name__, 'details': f'{type(exc).__name__} on line {line}'}
    finally:
        sys.settrace(None)
    result = {'steps': steps, 'duration': (time.perf_counter() - started) * 1000}
    if error:
        result['error'] = error
    return json.dumps(result, ensure_ascii=False, allow_nan=False)
