import { executeJavaScript } from "./interpreter";
self.onmessage = (event: MessageEvent<{ source: string }>) => {
  self.postMessage(executeJavaScript(event.data.source));
};
