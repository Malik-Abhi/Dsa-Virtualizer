export type Example = {
  id: string;
  name: string;
  category: string;
  description: string;
  code: string;
};
export const examples: Example[] = [
  {
    id: "bubble",
    name: "Bubble sort",
    category: "Sorting",
    description: "Compare neighbors. Swap. Repeat.",
    code: `// Move the largest value to the end of each pass.
const arr = [64, 34, 25, 12, 22, 11];

for (let i = 0; i < arr.length - 1; i++) {
  for (let j = 0; j < arr.length - i - 1; j++) {
    if (arr[j] > arr[j + 1]) {
      const temp = arr[j];
      arr[j] = arr[j + 1];
      arr[j + 1] = temp;
    }
  }
}

console.log("Sorted array:", arr);`,
  },
  {
    id: "traversal",
    name: "Array traversal",
    category: "Arrays",
    description: "Visit every element, one at a time.",
    code: `const arr = [5, 2, 8, 1];
let sum = 0;
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}
console.log("Sum:", sum);`,
  },
  {
    id: "memory-frames",
    name: "Even-index sum · frames & heap",
    category: "Arrays",
    description: "Follow parameters, references, and a moving index.",
    code: `function sumOfEvenIndexedElements(A, B) {
  const n = A.length;
  let prefix = 0;
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) prefix += A[i];
  }
  B.push(prefix);
  return prefix;
}
const result = sumOfEvenIndexedElements([2, 8, 3, 9, 15], [1, 4]);
console.log("Sum:", result);`,
  },
  {
    id: "linear",
    name: "Linear search",
    category: "Arrays",
    description: "Find a target with a sequential scan.",
    code: `const arr = [9, 4, 7, 2, 8];
const target = 7;
let found = -1;
for (let i = 0; i < arr.length; i++) {
  if (arr[i] === target) {
    found = i;
    break;
  }
}
console.log("Found at index:", found);`,
  },
  {
    id: "binary",
    name: "Binary search",
    category: "Arrays",
    description: "Cut the search space in half.",
    code: `const arr = [2, 5, 8, 12, 16, 23, 38];
const target = 16;
let left = 0;
let right = arr.length - 1;
let found = -1;
while (left <= right) {
  const mid = Math.floor((left + right) / 2);
  if (arr[mid] === target) {
    found = mid;
    break;
  }
  if (arr[mid] < target) {
    left = mid + 1;
  } else {
    right = mid - 1;
  }
}
console.log("Found:", found);`,
  },
  {
    id: "selection",
    name: "Selection sort",
    category: "Sorting",
    description: "Select the smallest remaining value.",
    code: `const arr = [29, 10, 14, 37, 13];
for (let i = 0; i < arr.length - 1; i++) {
  let min = i;
  for (let j = i + 1; j < arr.length; j++) {
    if (arr[j] < arr[min]) min = j;
  }
  const temp = arr[i];
  arr[i] = arr[min];
  arr[min] = temp;
}
console.log(arr);`,
  },
  {
    id: "insertion",
    name: "Insertion sort",
    category: "Sorting",
    description: "Build a sorted prefix, one value at a time.",
    code: `const arr = [12, 11, 13, 5, 6];
for (let i = 1; i < arr.length; i++) {
  const key = arr[i];
  let j = i - 1;
  while (j >= 0 && arr[j] > key) {
    arr[j + 1] = arr[j];
    j--;
  }
  arr[j + 1] = key;
}
console.log(arr);`,
  },
  {
    id: "reverse",
    name: "Reverse string",
    category: "Strings",
    description: "Read a string from right to left.",
    code: `const text = "algorithm";
let reversed = "";
for (let i = text.length - 1; i >= 0; i--) {
  reversed += text[i];
}
console.log(reversed);`,
  },
  {
    id: "palindrome",
    name: "Palindrome",
    category: "Strings",
    description: "Compare characters from both ends.",
    code: `const text = "racecar";
let left = 0;
let right = text.length - 1;
let palindrome = true;
while (left < right) {
  if (text[left] !== text[right]) {
    palindrome = false;
    break;
  }
  left++;
  right--;
}
console.log("Palindrome:", palindrome);`,
  },
  {
    id: "frequency",
    name: "Character frequency",
    category: "Strings",
    description: "Count occurrences in a property map.",
    code: `const text = "banana";
const counts = {};
for (let i = 0; i < text.length; i++) {
  const char = text[i];
  counts[char] = (counts[char] || 0) + 1;
}
console.log(counts);`,
  },
  {
    id: "stack",
    name: "Stack · push / pop",
    category: "Stack & Queue",
    description: "Last in, first out.",
    code: `const stack = [];
stack.push(10);
stack.push(20);
stack.push(30);
const top = stack.pop();
console.log("Popped:", top);
console.log("Stack:", stack);`,
  },
  {
    id: "queue",
    name: "Queue · enqueue / dequeue",
    category: "Stack & Queue",
    description: "First in, first out.",
    code: `const queue = [];
queue.push("A");
queue.push("B");
queue.push("C");
const first = queue.shift();
console.log("Dequeued:", first);
console.log(queue);`,
  },
  {
    id: "factorial",
    name: "Factorial",
    category: "Recursion",
    description: "Follow calls down to the base case.",
    code: `function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
const result = factorial(5);
console.log("Factorial:", result);`,
  },
  {
    id: "fibonacci",
    name: "Fibonacci",
    category: "Recursion",
    description: "Explore a branching call stack.",
    code: `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
const result = fibonacci(5);
console.log("Fibonacci:", result);`,
  },
  ...(["Traversal", "Insert", "Delete", "Reverse"] as const).map(
    (operation) => ({
      id: `list-${operation.toLowerCase()}`,
      name: `Linked list · ${operation.toLowerCase()}`,
      category: "Linked Lists",
      description: "Follow node references across the heap.",
      code: `const head = { value: 1, next: { value: 2, next: { value: 3, next: null } } };
${
  operation === "Insert"
    ? `head.next = { value: 4, next: head.next };
console.log(head);`
    : operation === "Delete"
      ? `head.next = head.next.next;
console.log(head);`
      : operation === "Reverse"
        ? `let prev = null;
let current = head;
while (current !== null) {
  const next = current.next;
  current.next = prev;
  prev = current;
  current = next;
}
console.log(prev);`
        : `let current = head;
while (current !== null) {
  console.log(current.value);
  current = current.next;
}`
}`,
    }),
  ),
  {
    id: "dfs",
    name: "Tree · depth-first search",
    category: "Trees",
    description: "Visit a tree recursively across connected nodes.",
    code: `const tree = { value: 4, left: { value: 2, left: null, right: null }, right: { value: 6, left: null, right: null } };
const visited = [];
function dfs(node) {
  if (node === null) return;
  visited.push(node.value);
  dfs(node.left);
  dfs(node.right);
}
dfs(tree);
console.log(visited);`,
  },
  {
    id: "bfs",
    name: "Tree · breadth-first search",
    category: "Trees",
    description: "Visit each level using a queue.",
    code: `const tree = { value: 4, left: { value: 2, left: null, right: null }, right: { value: 6, left: null, right: null } };
const queue = [tree];
const visited = [];
while (queue.length > 0) {
  const node = queue.shift();
  visited.push(node.value);
  if (node.left !== null) queue.push(node.left);
  if (node.right !== null) queue.push(node.right);
}
console.log(visited);`,
  },
  {
    id: "bst",
    name: "BST · insertion",
    category: "Trees",
    description: "Choose left or right to insert a node.",
    code: `const tree = { value: 4, left: null, right: null };
function insert(node, value) {
  if (value < node.value) {
    if (node.left === null) node.left = { value: value, left: null, right: null };
    else insert(node.left, value);
  } else {
    if (node.right === null) node.right = { value: value, left: null, right: null };
    else insert(node.right, value);
  }
}
insert(tree, 2);
insert(tree, 6);
insert(tree, 1);
console.log(tree);`,
  },
];
export const pythonExample = `# Build prefix sums of elements at even indices.
def sumOfEvenIndexedElements(A, B):
    n = len(A)
    prefix = [A[0]]
    for i in range(1, n):
        if i % 2 == 0:
            prefix.append(A[i] + prefix[i - 1])
        else:
            prefix.append(prefix[i - 1])
    B.append(prefix[-1])
    return prefix[-1]

A = [2, 8, 3, 9, 15]
B = [1, 4]
result = sumOfEvenIndexedElements(A, B)
print("Sum:", result)
print("B:", B)`;
