import { handleSaveLikeRequest, shouldInterceptUrl } from "./save-handler";

const endpointPatchedWindows = new WeakSet<Window>();
const endpointPatchKey = "__ooLocalEndpointPatch";

function setXhrResponse(xhr: XMLHttpRequest, responseText: string) {
  const setReadonly = (key: keyof XMLHttpRequest, value: unknown) => {
    try {
      Object.defineProperty(xhr, key, {
        configurable: true,
        enumerable: true,
        get: () => value,
      });
    } catch {
      try {
        (xhr as any)[key] = value;
      } catch {
        // Ignore assignment failures on read-only properties.
      }
    }
  };

  setReadonly("readyState", 4);
  setReadonly("status", 200);
  setReadonly("statusText", "OK");
  setReadonly("responseText", responseText);
  setReadonly("response", responseText);

  xhr.getAllResponseHeaders = () => "content-type: application/json\r\n";
  xhr.getResponseHeader = (name: string) =>
    name.toLowerCase() === "content-type" ? "application/json" : null;
}

export function installLocalEndpointPatch(targetWindow: Window) {
  const marker = targetWindow as Window & { [endpointPatchKey]?: boolean };
  if (endpointPatchedWindows.has(targetWindow) || marker[endpointPatchKey]) return;
  marker[endpointPatchKey] = true;
  endpointPatchedWindows.add(targetWindow);

  const fetchRef = targetWindow.fetch?.bind(targetWindow);
  if (fetchRef) {
    targetWindow.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (shouldInterceptUrl(targetWindow, url)) {
        const body = init?.body;
        const result = await handleSaveLikeRequest(targetWindow, url, body);
        if (result) {
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }
      }
      return fetchRef(input, init);
    }) as typeof targetWindow.fetch;
  }

  const OriginalXHR = (targetWindow as unknown as typeof globalThis).XMLHttpRequest as
    | typeof XMLHttpRequest
    | undefined;
  if (!OriginalXHR) {
    return;
  }

  const open = OriginalXHR.prototype.open;
  const send = OriginalXHR.prototype.send;

  OriginalXHR.prototype.open = function patchedOpen(
    this: XMLHttpRequest & { __ooUrl?: string },
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    const urlString = typeof url === "string" ? url : url.href;
    this.__ooUrl = urlString;
    return open.call(this, method, urlString, async ?? true, username, password);
  };

  OriginalXHR.prototype.send = function patchedSend(
    this: XMLHttpRequest & { __ooUrl?: string },
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    const url = this.__ooUrl;
    if (!url || !shouldInterceptUrl(targetWindow, url)) {
      return send.call(this, body);
    }

    void (async () => {
      try {
        const result = await handleSaveLikeRequest(targetWindow, url, body);
        if (!result) {
          send.call(this, body);
          return;
        }
        const responseText = JSON.stringify(result);
        setXhrResponse(this, responseText);
        queueMicrotask(() => {
          this.onreadystatechange?.call(this, new ProgressEvent("readystatechange"));
          this.onload?.call(this, new ProgressEvent("load"));
        });
      } catch (error) {
        console.error("Local save handler failed", error);
        send.call(this, body);
      }
    })();
  };
}

