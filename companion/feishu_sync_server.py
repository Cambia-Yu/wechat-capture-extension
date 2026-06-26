#!/usr/bin/env python3
"""飞书同步 Companion — 本地 HTTP 服务，包装 lark-cli"""

import http.server, json, os, tempfile, subprocess, base64, shutil
from pathlib import Path

PORT, HOST = 8765, '127.0.0.1'

def _is_executable(path):
    return path and os.path.isfile(path) and os.access(path, os.X_OK)


def _find_lark_cli():
    # launchd PATH is narrow. Prefer the user's local CLI over WorkBuddy's copy.
    candidates = [
        os.environ.get('WECHAT_CAPTURE_LARK_CLI'),
        os.path.expanduser('~/.local/bin/lark-cli'),
        os.path.expanduser('~/.workbuddy/binaries/node/cli-connector-packages/bin/lark-cli'),
        shutil.which('lark-cli'),
        '/usr/local/bin/lark-cli',
        '/opt/homebrew/bin/lark-cli',
    ]
    seen = set()
    for path in candidates:
        if not path:
            continue
        path = os.path.abspath(os.path.expanduser(path))
        if path in seen:
            continue
        seen.add(path)
        if _is_executable(path):
            return path
    return None


_LARK_CLI = _find_lark_cli()


def _run_lark_cli(args, cwd=None, timeout=30):
    env = {**os.environ, 'LARK_CLI_NO_PROXY': '1'}
    return subprocess.run(
        [_LARK_CLI, *args],
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=env,
    )


def _lark_cli_version():
    if not _LARK_CLI:
        return None
    try:
        r = subprocess.run([_LARK_CLI, '--version'], capture_output=True, text=True, timeout=5)
        return (r.stdout or r.stderr).strip() or None
    except Exception as e:
        return f'unavailable: {e}'


def _parse_json_output(text):
    text = (text or '').strip()
    if not text:
        raise ValueError('empty lark-cli JSON output')
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find('{')
        if start < 0:
            raise
        obj, _ = json.JSONDecoder().raw_decode(text[start:])
        return obj


def _markdown_with_remote_images(markdown, images):
    result = markdown
    for img in images:
        local_name = img.get('localName')
        original_url = img.get('originalUrl')
        if not local_name or not original_url:
            continue
        result = result.replace(f'](images/{local_name})', f']({original_url})')
        result = result.replace(f'](./images/{local_name})', f']({original_url})')
    return result

class Handler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._reply(200, {})

    def do_GET(self):
        if self.path == '/health':
            self._reply(200, {
                'status': 'ok' if _LARK_CLI else 'no-cli',
                'larkCli': bool(_LARK_CLI),
                'cliPath': _LARK_CLI,
                'cliVersion': _lark_cli_version(),
            })
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != '/sync':
            self.send_error(404); return
        try:
            cl = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(cl))
            result = self._sync(data)
            self._reply(200 if result.get('success') else 500, result)
        except Exception as e:
            self._reply(500, {'success': False, 'error': str(e)})

    def _reply(self, code, data):
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def _sync(self, data):
        if not _LARK_CLI:
            return {'success': False, 'error': 'lark-cli 未检测到，请先安装或设置 WECHAT_CAPTURE_LARK_CLI'}
        title = data.get('title', '未命名')
        markdown = data.get('markdown', '')
        images = data.get('images', [])
        work = Path(tempfile.mkdtemp(prefix='wxcap_'))
        try:
            feishu_markdown = _markdown_with_remote_images(markdown, images)
            (work / 'article.md').write_text(feishu_markdown, encoding='utf-8')
            img_dir = work / 'images'; img_dir.mkdir(exist_ok=True)
            saved = []
            for img in images:
                try:
                    b = base64.b64decode(img['data'])
                    p = img_dir / img.get('localName', f'img_{len(saved):03d}.jpeg')
                    p.write_bytes(b); saved.append(str(p))
                except Exception:
                    pass
            r = _run_lark_cli([
                'docs', '+create', '--api-version', 'v2',
                '--doc-format', 'markdown', '--content', '@article.md', '--as', 'user', '--json'
            ], cwd=work)
            if r.returncode != 0:
                return {'success': False, 'error': f'lark-cli 失败: {r.stderr or r.stdout or "exit="+str(r.returncode)}'}
            info = _parse_json_output(r.stdout)
            if not info.get('ok'):
                return {'success': False, 'error': f'lark-cli 错误: {json.dumps(info.get("error",{}), ensure_ascii=False)}'}
            doc = info['data']['document']
            result = {
                'success': True,
                'docId': doc['document_id'],
                'docUrl': doc.get('url',''),
                'imageCount': len(images),
                'imagePlacement': 'inline_markdown_remote_url',
                'title': title,
            }
            if saved and len(saved) != len(images):
                result['mediaWarning'] = f'{len(saved)}/{len(images)} images were available as local fallback files'
            return result
        except Exception as e:
            return {'success': False, 'error': str(e)}
        finally:
            try: shutil.rmtree(work)
            except Exception: pass

    def log_message(self, fmt, *args): pass

if __name__ == '__main__':
    print(f'Companion → http://{HOST}:{PORT}', flush=True)
    print(f'lark-cli → {_LARK_CLI or "NOT FOUND"}', flush=True)
    http.server.HTTPServer((HOST, PORT), Handler).serve_forever()
