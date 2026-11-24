"""用法：在仓库根目录运行 python3 tools/readme_images.py。
依赖：Python 3、Pillow、Playwright 及已安装的 WebKit、ffmpeg、PingFang SC。
默认启动仅监听回环地址的临时 HTTP 服务，输出到 .art-src/readme-images/。
macOS 限制监听端口时可加 --offline-webkit，用 clang 和系统 WebKit 离屏渲染。
"""
import argparse
import base64
import io
import json
import select
import shutil
import subprocess
import tempfile
import threading
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "prototype"
OUTPUT = ROOT / ".art-src/readme-images"
CATS = list(zip("cow orange lihua siamese black calico blue white maine sphynx".split(),
                "奶牛猫 橘猫 狸花猫 暹罗猫 黑猫 三花猫 英短蓝猫 异瞳白猫 缅因猫 无毛猫".split()))
# 保留游戏的 60 Hz 物理更新，每五次更新采样一次。截图耗时不计入游戏时间。
CLOCK = """
let simTick = 0, callbacks = [], seed = 1600;
performance.now = () => simTick * 1000 / 60;
Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
window.requestAnimationFrame = fn => callbacks.push(fn);
window.advance = n => {
  for(let i=0; i<n; i++) {
    simTick++;
    const pending = callbacks; callbacks = [];
    for (const fn of pending) fn(performance.now());
  }
};
window.stroke = (key, down) => window.dispatchEvent(new KeyboardEvent(
  down ? 'keydown' : 'keyup', {code:key===' ' ? 'Space' : 'Key'+key.toUpperCase(),key,bubbles:true}));
"""
SCENE_STYLE = """html,body {background: var(--bg) !important}
#scene {position:fixed;inset:0;width:100vw;height:100vh;max-width:none}
#controls,.hint {display:none}"""
GALLERY_STYLE = """*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:var(--bg)}
body{display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(2,1fr);
padding:2.8vh 2.5vw;place-items:center;font:500 1.8vw 'PingFang SC',sans-serif;color:#36373c}
figure{margin:0;text-align:center}img{display:block;width:14.8vw;height:32vh;object-fit:contain}
figcaption{margin-top:1.8vh}"""
GALLERY = ('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="style.css">'
           + '<style>' + GALLERY_STYLE + '</style><body>'
           + ''.join(f'<figure><img src="cats/{key}.svg"><figcaption>{name}</figcaption></figure>'
                     for key, name in CATS) + '</body>')
NATIVE = r'''
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

// Local WebKit 1 renders in-process, including when loopback is unavailable.
static void pump(double seconds) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
}
int main(int argc, char **argv) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        int width = atoi(argv[1]), height = atoi(argv[2]);
        NSRect rect = NSMakeRect(0, 0, width * 2, height * 2);
        WebView *view = [[WebView alloc] initWithFrame:rect];
        NSWindow *window = [[NSWindow alloc] initWithContentRect:rect styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        [window setContentView:view];
        NSString *html = [NSString stringWithContentsOfFile:@(argv[3]) encoding:NSUTF8StringEncoding error:nil];
        [[view mainFrame] loadHTMLString:html baseURL:[NSURL fileURLWithPath:@(argv[4]) isDirectory:YES]];
        for (int i=0;i<200 && (view.loading || ![view.mainFrame.DOMDocument readyState]);i++) pump(.025);
        pump(.1);
        char *line = NULL; size_t capacity = 0;
        while (getline(&line, &capacity, stdin) > 0) { @autoreleasepool {
            NSString *command = [@(line) stringByTrimmingCharactersInSet:[NSCharacterSet newlineCharacterSet]];
            if ([command hasPrefix:@"SHOT "]) {
                NSBitmapImageRep *bitmap = [view bitmapImageRepForCachingDisplayInRect:rect];
                [view cacheDisplayInRect:rect toBitmapImageRep:bitmap];
                NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
                BOOL ok = [png writeToFile:[command substringFromIndex:5] atomically:YES];
                puts(ok ? "ok" : "error");
            } else {
                NSString *result = [view stringByEvaluatingJavaScriptFromString:command];
                puts((result ?: @"").UTF8String);
            }
            fflush(stdout);
        }}
        free(line);
    }
}
'''


@contextmanager
def local_server():
    handler = partial(SimpleHTTPRequestHandler, directory=str(WEB))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}/"
        finally:
            server.shutdown()
            thread.join(timeout=3)


@contextmanager
def renderer(offline, tmp):
    if offline:
        source = tmp / 'reader.m'
        source.write_text(NATIVE)
        binary = tmp / 'reader'
        subprocess.run(['clang', '-w', '-framework', 'WebKit', '-framework', 'Cocoa',
                        str(source), '-o', str(binary)], check=True, timeout=30)
        yield partial(native_page, binary, tmp)
    else:
        with local_server() as url, sync_playwright() as pw:
            browser = pw.webkit.launch(timeout=12000)
            try:
                yield partial(browser_page, browser, url)
            finally:
                browser.close()


@contextmanager
def native_page(binary, tmp, size, query, gallery):
    html = GALLERY if gallery else (WEB / 'index.html').read_text()
    if gallery:
        for key, _ in CATS:
            svg = (WEB / 'cats' / f'{key}.svg').read_bytes()
            uri = 'data:image/svg+xml;base64,' + base64.b64encode(svg).decode()
            html = html.replace(f'cats/{key}.svg', uri)
    if not gallery:
        # loadHTMLString 的 baseURL 指向素材目录，查询串单独传给原页面解析。
        html = html.replace('new URLSearchParams(location.search)',
                            f'new URLSearchParams({json.dumps(query)})')
        html = html.replace('</head>', f'<style>{SCENE_STYLE}</style><script>{CLOCK}</script></head>')
    path = tmp / 'page.html'
    path.write_text(html)
    proc = subprocess.Popen([binary, *map(str, size), path, WEB],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

    def request(command):
        proc.stdin.write(command + '\n')
        proc.stdin.flush()
        if not select.select([proc.stdout], [], [], 12)[0]:
            raise TimeoutError(command[:80])
        return proc.stdout.readline().strip()

    def evaluate(code):
        result = request(f'JSON.stringify((()=>{{return ({code})}})() ?? null)')
        if not result:
            raise RuntimeError(f'WebKit evaluation failed: {code[:100]}')
        return json.loads(result)

    def capture():
        frame = tmp / 'capture.png'
        if request('SHOT ' + str(frame)) != 'ok':
            raise RuntimeError('WebKit snapshot failed')
        with Image.open(frame) as im:
            return im.convert('RGB')
    try:
        yield evaluate, capture
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=3)


@contextmanager
def browser_page(browser, url, size, query, gallery):
    page = browser.new_page(viewport=dict(zip(('width', 'height'), size)), device_scale_factor=2)
    page.set_default_timeout(12000)
    try:
        page.add_init_script(CLOCK)
        if gallery:
            page.route('**/gallery.html', lambda r: r.fulfill(body=GALLERY, content_type='text/html'))
        page.goto(url + ('gallery.html' if gallery else '?' + query), wait_until='networkidle')
        if not gallery:
            page.add_style_tag(content=SCENE_STYLE)
        def capture():
            with Image.open(io.BytesIO(page.screenshot(timeout=12000))) as im:
                return im.convert('RGB')
        yield page.evaluate, capture
    finally:
        page.close()


def render(open_page, name, tmp):
    gallery = name == 'cats'
    size = ((1500, 640) if gallery else (567, 460) if name in ('awake', 'sleep', 'strike')
            else (480, 394))
    query = dict(cat='cow', style='fur', push=0, sleep=120, work=2 if name=='rage' else 900,
                 statusbar=int(name in ('rage', 'strike')))
    if name == 'sleep':
        query.update(demo='slumped', **{'slump-style':'nod'})
    if name == 'strike':
        query.update(demo='strike')
    with open_page(size, urlencode(query), gallery) as (ev, capture):
        def snap():
            im = capture()
            if im.width < size[0]*2 or im.height < size[1]*2:
                raise ValueError('Insufficient capture resolution')
            return im.resize(size, Image.Resampling.LANCZOS)
        if gallery:
            assert ev('[...document.images].filter(i=>i.complete && i.naturalWidth).length') == 10
            return snap()
        assert ev("document.querySelectorAll('#cat-head image').length") >= 1
        view_box = '-12 -12 824 650' if name == 'typing' else '-55 -22 910 690'
        ev(f"document.querySelector('#scene').setAttribute('viewBox','{view_box}')")
        ev("advance(12)")
        if name == 'sleep':
            ev("advance(122)")
            assert ev("__cat.sleepStage") == 'slumped'
        if name == 'strike':
            ev("advance(30)")
            assert ev("__cat.state") == 'strike'
        if name == 'awake':
            assert ev("Number(document.querySelector('#lid-l').getAttribute('height'))") < 15
        if name not in ('typing','rage'):
            return snap()

        folder = tmp / name
        folder.mkdir()
        if name == 'rage':
            for char in "keyboard":
                ev(f"stroke('{char}',true), advance(5), stroke('{char}',false), advance(8)")
            assert ev("__cat.mood") == 'angry'
            assert ev("__cat.fatigue") < 1
        starts = dict(zip([3,5,7,8,10,14,17,19,21,24,26], "hello world"))
        count = 50 if name == 'typing' else 52
        held = None
        for index in range(count):
            if held:
                ev(f"stroke({json.dumps(held)},false)")
            held = starts.get(index) if name=='typing' else ('k' if index < 4 else None)
            if held:
                ev(f"stroke({json.dumps(held)},true)")
            ev("advance(5)")
            if name == 'typing':
                assert ev("__cat.state==='awake' && __cat.mood==='fine' && +document.querySelector('#lid-l').getAttribute('height')<18")
            if name=='rage' and index==0:
                assert ev("document.querySelector('#status-bar').classList.contains('sb-annoyed')")
            if index == count-1 and name=='rage':
                assert ev("__cat.state") == 'strike'
            snap().save(folder / f'{index:03}.png')
        return folder


def encode(folder, dest):
    ffmpeg = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
    for colors in (256, 192, 128, 96, 64):
        palette = (f'[0:v]split[a][b];[a]palettegen=max_colors={colors}[p];'
                   '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle')
        subprocess.run([ffmpeg,'-nostdin','-v','error','-y','-framerate','12','-i',str(folder/'%03d.png'),
                        '-filter_complex',palette,'-loop','0',str(dest)], check=True, timeout=120)
        if dest.stat().st_size <= 1500000:
            return


def preview(path):
    with Image.open(path) as im:
        if im.n_frames == 1:
            sheet = im.convert('RGB')
        else:
            sheet = Image.new('RGB',(1200,394))
            for i in range(10):
                im.seek(round(i*(im.n_frames-1)/9))
                sheet.paste(im.convert('RGB').resize((240,197),Image.Resampling.LANCZOS),
                            (i%5*240,i//5*197))
        sheet.thumbnail((1280,1280),Image.Resampling.LANCZOS)
        sheet.save(path.with_name(path.stem+'-preview.jpg'),quality=85)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline-webkit',action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as directory:
        tmp = Path(directory)
        with renderer(args.offline_webkit,tmp) as open_page:
            for name in ('typing','rage'):
                encode(render(open_page,name,tmp),tmp/(name+'.gif'))
            states = Image.new('RGB',(1700,460))
            for index,name in enumerate(('awake','sleep','strike')):
                states.paste(render(open_page,name,tmp),(round(1700*index/3),0))
            states.save(tmp/'states.png',optimize=True)
            render(open_page,'cats',tmp).save(tmp/'cats.png',optimize=True)
        for name in ('typing.gif','rage.gif','states.png','cats.png'):
            p = tmp/name
            if p.stat().st_size > (1500000 if p.suffix=='.gif' else 1000000):
                raise ValueError(f'{name} exceeds size budget ({p.stat().st_size} bytes)')
            preview(p)
        OUTPUT.mkdir(parents=True,exist_ok=True)
        for path in tmp.iterdir():
            if path.suffix in ('.gif','.jpg') or path.name in ('states.png','cats.png'):
                shutil.copyfile(path,OUTPUT/path.name)


if __name__ == '__main__':
    main()
