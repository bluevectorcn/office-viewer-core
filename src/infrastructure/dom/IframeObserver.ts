import { injectIntoIframe } from "../../application/initialization/GlobalInjector";

export function observeEditorIframes(container: HTMLElement) {
  const seen = new WeakSet<HTMLIFrameElement>();

  const handleFrame = (frame: HTMLIFrameElement) => {
    if (seen.has(frame)) return;
    seen.add(frame);
    injectIntoIframe(frame);
  };

  const scanNode = (node: Node) => {
    if (node instanceof HTMLIFrameElement) {
      handleFrame(node);
      return;
    }
    if (node instanceof HTMLElement) {
      node.querySelectorAll("iframe").forEach(handleFrame);
    }
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(scanNode);
    }
  });

  observer.observe(container, { childList: true, subtree: true });
  container.querySelectorAll("iframe").forEach(handleFrame);

  return () => observer.disconnect();
}

