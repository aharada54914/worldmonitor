'use strict';

const net = require('node:net');
const tls = require('node:tls');
const https = require('node:https');
const zlib = require('node:zlib');

function parseProxyConfig(raw) {
  if (!raw) return null;

  try {
    const u = new URL(raw);
    if (u.hostname) {
      return {
        host: u.hostname,
        port: parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10),
        auth: u.username ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}` : null,
        tls: u.protocol === 'https:',
      };
    }
  } catch {}

  if (raw.includes('@')) {
    const atIdx = raw.lastIndexOf('@');
    const auth = raw.slice(0, atIdx);
    const hostPort = raw.slice(atIdx + 1);
    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx !== -1) {
      const host = hostPort.slice(0, colonIdx);
      const port = parseInt(hostPort.slice(colonIdx + 1), 10);
      if (host && port && auth) return { host, port, auth, tls: false };
    }
  }

  const parts = raw.split(':');
  if (parts.length >= 4) {
    const host = parts[0];
    const port = parseInt(parts[1], 10);
    const user = parts[2];
    const pass = parts.slice(3).join(':');
    if (host && port && user) return { host, port, auth: `${user}:${pass}`, tls: false };
  }

  return null;
}

function proxyConnectTunnel(targetHostname, proxyConfig, { timeoutMs = 20_000, targetPort = 443 } = {}) {
  return new Promise((resolve, reject) => {
    let proxySock;
    const timer = setTimeout(() => {
      proxySock?.destroy();
      reject(new Error('CONNECT tunnel timeout'));
    }, timeoutMs);

    const fail = (error) => {
      clearTimeout(timer);
      proxySock?.destroy();
      reject(error);
    };

    const connectCb = () => {
      const authHeader = proxyConfig.auth
        ? `\r\nProxy-Authorization: Basic ${Buffer.from(proxyConfig.auth).toString('base64')}`
        : '';
      proxySock.write(
        `CONNECT ${targetHostname}:${targetPort} HTTP/1.1\r\nHost: ${targetHostname}:${targetPort}${authHeader}\r\n\r\n`
      );

      let buffer = '';
      const onData = (chunk) => {
        buffer += chunk.toString('ascii');
        if (!buffer.includes('\r\n\r\n')) return;
        proxySock.removeListener('data', onData);
        const statusLine = buffer.split('\r\n')[0];
        if (!statusLine.startsWith('HTTP/1.1 200') && !statusLine.startsWith('HTTP/1.0 200')) {
          return fail(Object.assign(new Error(`Proxy CONNECT: ${statusLine}`), {
            status: parseInt(statusLine.split(' ')[1], 10) || 0,
          }));
        }

        proxySock.pause();
        const tlsSocket = tls.connect(
          { socket: proxySock, servername: targetHostname, ALPNProtocols: ['http/1.1'] },
          () => {
            clearTimeout(timer);
            proxySock.resume();
            resolve({
              socket: tlsSocket,
              destroy: () => {
                tlsSocket.destroy();
                proxySock.destroy();
              },
            });
          }
        );
        tlsSocket.on('error', fail);
      };

      proxySock.on('data', onData);
    };

    if (proxyConfig.tls) {
      proxySock = tls.connect(
        { host: proxyConfig.host, port: proxyConfig.port, servername: proxyConfig.host, ALPNProtocols: ['http/1.1'] },
        connectCb
      );
    } else {
      proxySock = net.connect({ host: proxyConfig.host, port: proxyConfig.port }, connectCb);
    }
    proxySock.on('error', fail);
  });
}

function proxyFetch(url, proxyConfig, {
  accept = '*/*',
  headers = {},
  method = 'GET',
  body = null,
  timeoutMs = 20_000,
} = {}) {
  const targetUrl = new URL(url);
  return proxyConnectTunnel(targetUrl.hostname, proxyConfig, { timeoutMs }).then(({ socket: tlsSocket, destroy }) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        destroy();
        reject(new Error('proxy fetch timeout'));
      }, timeoutMs);

      const fail = (error) => {
        clearTimeout(timer);
        destroy();
        reject(error);
      };

      const requestHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: accept,
        'Accept-Encoding': 'gzip, deflate',
        ...headers,
      };
      if (body != null && !Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'content-length')) {
        requestHeaders['Content-Length'] = Buffer.byteLength(body);
      }

      const req = https.request({
        hostname: targetUrl.hostname,
        path: targetUrl.pathname + targetUrl.search,
        method,
        headers: requestHeaders,
        createConnection: () => tlsSocket,
      }, (resp) => {
        let stream = resp;
        const enc = (resp.headers['content-encoding'] || '').trim().toLowerCase();
        if (enc === 'gzip') stream = resp.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = resp.pipe(zlib.createInflate());

        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
          clearTimeout(timer);
          destroy();
          resolve({
            ok: resp.statusCode >= 200 && resp.statusCode < 300,
            status: resp.statusCode,
            buffer: Buffer.concat(chunks),
            contentType: resp.headers['content-type'] || '',
          });
        });
        stream.on('error', fail);
      });
      req.on('error', fail);
      if (body != null) req.write(body);
      req.end();
    });
  });
}

module.exports = { parseProxyConfig, proxyConnectTunnel, proxyFetch };
