export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 拦截对 .wasm 的请求
    if (pathname.endsWith('.wasm')) {
      // 检查请求是否接受 brotli
      const acceptEncoding = request.headers.get('Accept-Encoding') || '';
      const canBrotli = acceptEncoding.includes('br');

      if (canBrotli) {
        const brUrl = new URL(request.url + '.br');
        const response = await env.ASSETS.fetch(new Request(brUrl, request));

        if (response.ok) {
          const newHeaders = new Headers(response.headers);
          newHeaders.set('Content-Encoding', 'br');
          newHeaders.set('Content-Type', 'application/wasm');
          // 告知缓存根据压缩格式区分，同时保留已有的 Vary 项。
          const vary = newHeaders.get('Vary');
          newHeaders.set('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
          
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
            // `response.body` 已经是预压缩的 brotli 内容，避免 Workers 再次编码。
            encodeBody: 'manual'
          });
        }
      }
    }

    return env.ASSETS.fetch(request);
  }
};
