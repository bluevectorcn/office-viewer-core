export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 如果请求的是 .wasm 文件，我们实际上已经删除了它，转而请求 .wasm.br
    if (pathname.endsWith('.wasm')) {
      const brRequest = new Request(request.url + '.br', request);
      const response = await env.ASSETS.fetch(brRequest);

      if (response.ok) {
        // 创建新的响应以修改头部
        const newResponse = new Response(response.body, response);
        newResponse.headers.set('Content-Encoding', 'br');
        newResponse.headers.set('Content-Type', 'application/wasm');
        return newResponse;
      }
    }

    return env.ASSETS.fetch(request);
  }
};
