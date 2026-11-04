// Run with Node 24+: node tests/folder-animation.browser.cjs <artifact-directory>
// Uses an isolated headless Edge profile and local fixtures; no npm dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), `motab-folder-qa-${Date.now()}`));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
let browser, socket, server;

async function main() {
    await fs.mkdir(output, { recursive: true });
    const profile = await fs.mkdtemp(path.join(output, 'edge-profile-'));
    server = http.createServer(async (request, response) => {
        try {
            const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '');
            const file = path.resolve(root, relative || 'startpage.html');
            if (!file.startsWith(root + path.sep)) throw new Error('outside root');
            const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.png': 'image/png', '.ico': 'image/x-icon' };
            response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': "script-src 'self'; object-src 'self'" });
            response.end(await fs.readFile(file));
        } catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = spawn(process.env.MOTAB_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
        '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
        '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
        '--window-size=1440,960', 'about:blank',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let browserError = '', launchError;
    browser.on('error', error => { launchError = error; });
    browser.stderr.on('data', data => { browserError = (browserError + data).slice(-6000); });
    let activePort;
    for (let attempt = 0; attempt < 150; attempt++) {
        if (launchError) throw launchError;
        try { activePort = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); break; }
        catch { await sleep(100); }
    }
    if (!activePort) throw new Error(`Edge did not start: ${browserError}`);
    socket = new WebSocket(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let nextId = 0;
    const pending = new Map(), exceptions = [];
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
        if (message.id && pending.has(message.id)) {
            const { resolve, reject, timer } = pending.get(message.id);
            clearTimeout(timer); pending.delete(message.id);
            if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
        }
    });
    function command(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            const id = ++nextId;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 12000);
            pending.set(id, { resolve, reject, timer });
            socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    const cdp = (method, params) => command(method, params, sessionId);
    async function evaluate(expression) {
        const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || JSON.stringify(response.exceptionDetails));
        return response.result.value;
    }
    await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable');
    await cdp('Network.setBlockedURLs', { urls: ['https://*'] });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/startpage.html` });
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate("typeof State !== 'undefined' && document.readyState === 'complete'")) break;
        await sleep(50);
    }
    const installQa = `window.qa = {
        content: () => document.querySelector('.folder-popup-content'),
        backdrop: () => document.querySelector('.folder-popup-backdrop'),
        popup: () => document.getElementById('folder-popup'),
        icon: (id = 'qa-folder') => [...document.querySelectorAll('#shortcuts-grid .shortcut-item')].find(el => el.dataset.id === id).querySelector('.shortcut-icon'),
        assert: (value, message) => { if (!value) throw Error(message); },
        near: (a, b) => Math.abs(a-b) < 0.1,
        pose: () => { const s = getComputedStyle(qa.content()); const m = new DOMMatrixReadOnly(s.transform); return [m.a,m.b,m.c,m.d,m.e,m.f,Number(s.opacity),Number(getComputedStyle(qa.backdrop()).opacity)]; },
        same: (a,b) => a.every((value,index) => Math.abs(value-b[index]) < 0.001),
        pause: time => { for (const a of [folderPopupMotion.panel,folderPopupMotion.backdrop]) { a.pause(); a.currentTime = time; } },
        frame: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        waitFor: async (predicate, label = 'condition') => {
            const end=performance.now()+4000;
            while(!await predicate()){ if(performance.now()>end) throw Error('Timed out: '+label); await new Promise(resolve=>setTimeout(resolve,20)); }
        },
        imageFile: async (name='fixture.png') => {
            const canvas=document.createElement('canvas'); canvas.width=320; canvas.height=240;
            const ctx=canvas.getContext('2d'); ctx.fillStyle='#B19CD9'; ctx.fillRect(0,0,320,240);
            ctx.fillStyle='#8EC5FC'; ctx.fillRect(160,0,160,240);
            const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
            return new File([blob],name,{type:'image/png'});
        },
        upload: (input,file) => { const transfer=new DataTransfer(); transfer.items.add(file); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); },
        finish: async () => { if (folderPopupMotion) { folderPopupMotion.backdrop.finish(); folderPopupMotion.panel.finish(); } await qa.frame(); },
        open: (id = 'qa-folder') => showFolderPopup(State.shortcuts.find(s => s.id === id),qa.icon(id)),
        closed: () => !qa.popup().classList.contains('show') && folderPopupState.folder === null && folderPopupMotion === null,
        reset: async () => {
            setLayoutEditing(false);
            if (qa.popup().classList.contains('show')) { hideFolderPopup(); await qa.finish(); }
            State.shortcuts = [{ id:'qa-folder',type:'folder',name:'常用工具',children:Array.from({length:12},(_,i)=>({id:'qa-'+i,name:['浏览器','设计','笔记','工作台','音乐','日历','照片','开发'][i%8],url:'https://qa'+i+'.test/'})) },{id:'qa-empty',type:'folder',name:'空文件夹',children:[]}];
            for(let i=0;i<12;i++) iconFailedHosts.add('qa'+i+'.test');
            renderShortcuts();
        }
    };`;
    await evaluate(installQa); await evaluate('qa.reset()');
    async function reload() {
        await cdp('Page.reload');
        for(let attempt=0;attempt<100;attempt++) {
            try { if(await evaluate("typeof State !== 'undefined' && document.readyState === 'complete'")) break; } catch {}
            await sleep(50);
        }
        await evaluate(installQa);
    }
    async function test(name, expression) {
        await evaluate('qa.reset()');
        await evaluate(`(async () => { ${expression} })()`);
        results.push({ name, passed: true });
        console.log(`PASS ${name}`);
    }
    await test('closed overlay does not intercept input', `qa.assert(qa.closed(),'state'); qa.assert(getComputedStyle(qa.popup()).visibility==='hidden','visibility'); qa.assert(getComputedStyle(qa.popup()).pointerEvents==='none','pointer events');`);
    await test('opening begins at actual folder icon and finishes centered', `
        qa.open(); qa.pause(0);
        let p=qa.content().getBoundingClientRect(), i=qa.icon().getBoundingClientRect();
        qa.assert(qa.near(p.x+p.width/2,i.x+i.width/2)&&qa.near(p.y+p.height/2,i.y+i.height/2),'source center');
        qa.assert(qa.near(p.width,i.width),'source width');
        qa.assert([...document.querySelectorAll('.folder-popup-item')].every(el=>getComputedStyle(el).animationName==='none'),'nested entrance animation');
        await qa.finish(); p=qa.content().getBoundingClientRect();
        qa.assert(qa.near(p.x+p.width/2,720)&&qa.near(p.y+p.height/2,480),'centered');
        qa.assert(!folderPopupMotion&&!qa.content().style.willChange,'animation cleanup');`);
    await cdp('Page.captureScreenshot', { format: 'png' }).then(image => fs.writeFile(path.join(output, 'folder-open.png'), Buffer.from(image.data, 'base64')));
    await test('closing during opening preserves the current rendered pose', `
        qa.open(); qa.pause(80); const before=qa.pose(); hideFolderPopup(); qa.pause(0);
        qa.assert(qa.same(before,qa.pose()),'close jumped'); await qa.finish(); qa.assert(qa.closed(),'closed');`);
    await test('reopening during closing keeps pose, child DOM and page', `
        qa.open(); await qa.finish(); folderPopupState.page=1; renderFolderPopup(false);
        const node=document.querySelector('.folder-popup-item'); hideFolderPopup(); qa.pause(90); const before=qa.pose();
        qa.open(); qa.pause(0); qa.assert(qa.same(before,qa.pose()),'reopen jumped');
        qa.assert(node===document.querySelector('.folder-popup-item')&&folderPopupState.page===1,'content recreated');
        await qa.finish(); await new Promise(resolve=>setTimeout(resolve,300));
        qa.assert(qa.popup().classList.contains('show')&&folderPopupState.folder.id==='qa-folder','stale close callback');`);
    await test('repeated cycles release animations and transient hints', `
        for(let i=0;i<8;i++){qa.open(); await qa.finish(); hideFolderPopup(); await qa.finish();}
        qa.assert(qa.closed(),'cycles'); qa.assert(!qa.content().getAnimations().length&&!qa.backdrop().getAnimations().length,'animation leak');
        qa.assert(!qa.content().style.willChange&&!qa.backdrop().style.willChange,'will-change leak');`);
    await test('closing remeasures icon after the grid is rebuilt', `
        qa.open(); await qa.finish(); const old=qa.icon(); State.shortcuts.reverse(); renderShortcuts(); qa.assert(!old.isConnected,'fixture');
        hideFolderPopup(); qa.pause(folderPopupMotion.panel.effect.getTiming().duration);
        const p=qa.content().getBoundingClientRect(),i=qa.icon().getBoundingClientRect();
        qa.assert(qa.near(p.x+p.width/2,i.x+i.width/2)&&qa.near(p.y+p.height/2,i.y+i.height/2),'wrong closing destination'); await qa.finish();`);
    await test('empty folder opens and closes without errors', `qa.open('qa-empty'); await qa.finish(); qa.assert(document.querySelectorAll('.folder-popup-item').length===0,'empty items'); hideFolderPopup(); await qa.finish(); qa.assert(qa.closed(),'empty close');`);
    await test('keyboard pagination, dots and Escape still work', `
        qa.open(); await qa.finish(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
        qa.assert(folderPopupState.page===1&&document.querySelectorAll('.folder-popup-item').length===4,'next page');
        document.querySelector('.folder-popup-dot').click(); qa.assert(folderPopupState.page===0,'dots');
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await qa.finish(); qa.assert(qa.closed(),'Escape');`);
    await test('close button and backdrop close the folder', `
        qa.open(); await qa.finish(); document.getElementById('folder-popup-close').click(); await qa.finish(); qa.assert(qa.closed(),'close button');
        qa.open(); await qa.finish(); qa.backdrop().click(); await qa.finish(); qa.assert(qa.closed(),'backdrop');
        qa.assert(['.folder-popup-content','.folder-popup-close','.folder-popup-dots'].every(selector=>getComputedStyle(document.querySelector(selector)).visibility==='hidden'),'closed popup descendants still visible');`);
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await test('reduced motion immediately switches states', `qa.open(); qa.assert(!folderPopupMotion&&qa.popup().classList.contains('show'),'reduce open'); hideFolderPopup(); qa.assert(qa.closed(),'reduce close');`);
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await test('missing WAAPI still permits opening and closing', `
        const animate=Element.prototype.animate; try { Element.prototype.animate=undefined; qa.open(); qa.assert(!folderPopupMotion&&qa.popup().classList.contains('show'),'fallback open'); hideFolderPopup(); qa.assert(qa.closed(),'fallback close'); } finally {Element.prototype.animate=animate;}`);
    await test('drag during opening settles animation before sorting coordinates', `
        setLayoutEditing(true); qa.open(); qa.pause(80); const el=document.querySelector('.folder-popup-item'),r=el.getBoundingClientRect();
        startDrag(el,{clientX:r.x+r.width/2,clientY:r.y+r.height/2},'popup');
        handleDragMove({clientX:r.x+r.width/2+8,clientY:r.y+r.height/2,preventDefault(){}});
        qa.assert(!folderPopupMotion,'WAAPI still running'); qa.assert(!dragState.enteredGrid,'unexpected drag out');
        qa.assert(popupOriginalPositions.length===8&&popupOriginalPositions.every(r=>r.width>70&&r.width<100),'scaled coordinates');
        const before=State.shortcuts[0].children.map(c=>c.id).sort().join(); handleDragEnd({});
        qa.assert(State.shortcuts[0].children.map(c=>c.id).sort().join()===before,'sort lost item');`);
    await test('dragging out transfers exactly one child to another folder', `
        setLayoutEditing(true); qa.open(); await qa.finish(); const el=document.querySelector('.folder-popup-item'),r=el.getBoundingClientRect();
        const id=el.dataset.childId, target=qa.icon('qa-empty').getBoundingClientRect();
        startDrag(el,{clientX:r.x+r.width/2,clientY:r.y+r.height/2},'popup');
        handleDragMove({clientX:target.x+target.width/2,clientY:target.y+target.height/2,preventDefault(){}});
        qa.assert(dragState.enteredGrid,'not dragged out'); handleDragEnd({}); await qa.finish();
        qa.assert(State.shortcuts[0].children.length===11&&State.shortcuts[1].children.length===1,'wrong counts');
        qa.assert(State.shortcuts[1].children[0].id===id&&!State.shortcuts[0].children.some(c=>c.id===id),'wrong item');`);
    await test('blank context menu enters editing and Done restores normal mode', `
        document.querySelector('.main-content').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:200}));
        qa.assert(!document.getElementById('layout-menu').hidden,'menu missing');
        document.getElementById('layout-start').click();
        qa.assert(layoutEditing&&!document.getElementById('layout-toolbar').hidden,'not editing');
        document.getElementById('layout-done').click(); qa.assert(!layoutEditing,'not finished');`);
    await test('normal mode blocks dragging; edit mode blocks link and middle click', `
        qa.open(); await qa.finish(); const el=document.querySelector('.folder-popup-item'),r=el.getBoundingClientRect();
        startDrag(el,{clientX:r.x,clientY:r.y},'popup'); qa.assert(!dragState,'normal mode draggable');
        setLayoutEditing(true);
        for(const type of ['click','auxclick']) {
            const ev=new MouseEvent(type,{bubbles:true,cancelable:true,button:type==='auxclick'?1:0});
            el.dispatchEvent(ev); qa.assert(ev.defaultPrevented,'editing navigates');
        }`);
    await test('drag returned to original slot suppresses click after editing ends', `
        setLayoutEditing(true); qa.open(); await qa.finish();
        const el=document.querySelector('.folder-popup-item'),r=el.getBoundingClientRect(),id=el.dataset.childId;
        const before=JSON.stringify(snapshotForUndo());
        startDrag(el,{clientX:r.x+r.width/2,clientY:r.y+20},'popup');
        handleDragMove({clientX:r.x+r.width/2+8,clientY:r.y+20,preventDefault(){}});
        handleDragMove({clientX:r.x+r.width/2,clientY:r.y+20,preventDefault(){}});
        handleDragEnd({}); qa.assert(JSON.stringify(snapshotForUndo())===before,'original slot changed data');
        setLayoutEditing(false);
        const current=[...document.querySelectorAll('.folder-popup-item')].find(node=>node.dataset.childId===id);
        qa.assert(current&&current.isConnected,'click target no longer in folder');
        const ev=new MouseEvent('click',{bubbles:true,cancelable:true}); current.dispatchEvent(ev);
        qa.assert(ev.defaultPrevented,'drag click not suppressed');`);
    await test('folder transfer undo restores both folders and persisted state', `
        setLayoutEditing(true); qa.open(); await qa.finish();
        const before=JSON.stringify(snapshotForUndo());
        const el=document.querySelector('.folder-popup-item'),r=el.getBoundingClientRect(),t=qa.icon('qa-empty').getBoundingClientRect();
        startDrag(el,{clientX:r.x+30,clientY:r.y+30},'popup');
        handleDragMove({clientX:t.x+t.width/2,clientY:t.y+t.height/2,preventDefault(){}}); handleDragEnd({}); await qa.finish();
        qa.assert(layoutHistory.length===1,'no undo'); document.getElementById('layout-undo').click();
        qa.assert(JSON.stringify(snapshotForUndo())===before,'undo differs');
        qa.assert(JSON.stringify(JSON.parse(localStorage.getItem('motab_shortcuts')))===JSON.stringify(State.shortcuts),'undo not saved');`);
    await test('window blur cancels active drag without committing', `
        setLayoutEditing(true); qa.open(); await qa.finish(); const before=JSON.stringify(snapshotForUndo());
        const el=document.querySelector('.folder-popup-item'),r=el.getBoundingClientRect();
        startDrag(el,{clientX:r.x+30,clientY:r.y+30},'popup');
        handleDragMove({clientX:r.x+45,clientY:r.y+30,preventDefault(){}});
        window.dispatchEvent(new Event('blur')); qa.assert(!dragState&&!document.querySelector('.drag-ghost'),'drag remains');
        qa.assert(JSON.stringify(snapshotForUndo())===before,'cancel committed');`);
    await test('appearance and media integrations are available', `
        qa.assert(typeof MotabMedia==='object'&&typeof MotabAppearance==='object','appearance modules absent');
        qa.assert(typeof createPortableBackup==='function'&&typeof restorePortableBackup==='function','portable backup integration absent');
        await MotabMedia.init();`);
    await test('uploaded raster image is stored and can be decoded from IndexedDB', `
        const id=await MotabMedia.putImage(await qa.imageFile(),{kind:'icon',x:50,y:50,zoom:1});
        const url=await MotabMedia.getUrl(id),image=new Image(); image.src=url; await image.decode();
        qa.assert(image.naturalWidth>0&&image.naturalHeight>0,'stored image cannot decode');
        const assets=await MotabMedia.exportAssets([id]);
        qa.assert(Object.keys(assets).length===1&&assets[id].startsWith('data:image/'),'portable resource missing');
        let rejected=false; try{await MotabMedia.putImage(new File(['not an image'],'invalid.png',{type:'image/png'}),{kind:'icon',x:50,y:50,zoom:1});}catch{rejected=true;}
        qa.assert(rejected,'corrupt image accepted');`);
    await test('custom icon renders consistently on desktop, folder and Dock', `
        const id=await MotabMedia.putImage(await qa.imageFile(),{kind:'icon',x:50,y:50,zoom:1});
        State.shortcuts[0].children[0].iconAsset=id;
        State.shortcuts.push({...State.shortcuts[0].children[0],id:'qa-desktop'});
        State.dock=[{...State.shortcuts[0].children[0]}]; saveShortcuts(); saveDock(); renderShortcuts(); renderDock();
        qa.open(); await qa.finish();
        const selectors=['.shortcut-item[data-id="qa-desktop"] .custom-icon-image','.shortcut-item[data-id="qa-folder"] .mini-icon .custom-icon-image','.folder-popup-item[data-child-id="qa-0"] .custom-icon-image','.dock-item[data-id="qa-0"] .custom-icon-image'];
        await qa.waitFor(()=>selectors.every(selector=>document.querySelector(selector)?.naturalWidth>0),'custom icon in all locations');
        const url=await MotabMedia.getUrl(id); qa.assert(selectors.every(selector=>document.querySelector(selector).src===url),'custom icon differs across surfaces');
        hideFolderPopup(); await qa.finish();`);
    await evaluate('qa.frame()');
    await cdp('Page.captureScreenshot', { format: 'png' }).then(image => fs.writeFile(path.join(output, 'custom-icons.png'), Buffer.from(image.data, 'base64')));
    await reload();
    await evaluate(`(async()=>{
        qa.assert(State.shortcuts[0].children[0].iconAsset,'custom icon metadata lost after reload');
        const id=State.shortcuts[0].children[0].iconAsset,url=await MotabMedia.getUrl(id); qa.assert(url,'custom icon Blob lost after reload');
        await qa.waitFor(()=>document.querySelector('.dock-item[data-id="qa-0"] .custom-icon-image')?.naturalWidth>0,'persisted Dock icon');
    })()`);
    results.push({name:'custom icon metadata and image survive reload',passed:true});
    console.log('PASS custom icon metadata and image survive reload');
    await test('appearance settings persist and resized icons keep their layout slots', `
        for(const size of ['small','medium','large']){
            await persistAppearanceDraft({...State,appearance:{...State.appearance,iconSize:size,showNames:false,iconStyle:'tinted',tint:'#8EC5FC'}});
            qa.assert(State.appearance.iconSize===size&&JSON.parse(localStorage.getItem('motab_appearance')).iconSize===size,'appearance not saved');
            qa.assert(qa.near(qa.icon().getBoundingClientRect().width,{small:80,medium:96,large:108}[size]),'desktop icon CSS size not applied');
            qa.assert(qa.near(document.querySelector('.dock-item').getBoundingClientRect().width,{small:48,medium:56,large:64}[size]),'Dock CSS size not applied');
            qa.assert(getComputedStyle(document.querySelector('.shortcut-item > .shortcut-name')).display==='none','desktop names still visible');
            qa.assert(getComputedStyle(qa.icon()).backgroundColor==='rgb(142, 197, 252)','theme tint CSS not applied');
            const tintedImage=document.querySelector('.dock-item img');qa.assert(tintedImage&&getComputedStyle(tintedImage).filter.includes('grayscale(1)')&&getComputedStyle(tintedImage).mixBlendMode==='multiply','theme image CSS not applied');
            const boxes=[...document.querySelectorAll('#shortcuts-grid .shortcut-icon')].filter(el=>!el.closest('.mini-icon')).map(el=>el.getBoundingClientRect());
            qa.assert(boxes.every((a,index)=>boxes.every((b,other)=>index===other||a.right<=b.left+0.1||b.right<=a.left+0.1||a.bottom<=b.top+0.1||b.bottom<=a.top+0.1)),'desktop icons overlap');
            qa.open(); await qa.finish(); const slots=[...document.querySelectorAll('.folder-popup-item')].map(el=>el.getBoundingClientRect());
            qa.assert(qa.near(document.querySelector('.folder-popup-item .shortcut-icon').getBoundingClientRect().width,{small:56,medium:64,large:72}[size]),'folder icon CSS size not applied');
            qa.assert(getComputedStyle(document.querySelector('.folder-popup-item > .shortcut-name')).display==='none','folder names still visible');
            qa.assert(slots.every((a,index)=>slots.every((b,other)=>index===other||a.right<=b.left+0.1||b.right<=a.left+0.1||a.bottom<=b.top+0.1||b.bottom<=a.top+0.1)),'folder slots overlap');
            hideFolderPopup(); await qa.finish();
        }
        await persistAppearanceDraft({...State,appearance:{...MotabData.DEFAULTS.appearance}});`);
    await test('wallpaper upload, position, zoom, blur and dim are persisted', `
        const assetId=await MotabMedia.putImage(await qa.imageFile('wallpaper.png'),{kind:'wallpaper',x:50,y:50,zoom:1});
        const settings={assetId,x:30,y:70,zoom:1.2,blur:4,dim:25};
        await persistAppearanceDraft({...State,wallpaperSettings:settings});
        const style=document.getElementById('wallpaper').style;
        qa.assert(style.backgroundImage.includes('blob:'),'custom wallpaper missing');
        qa.assert(style.backgroundPosition==='30% 70%'&&style.filter==='blur(4px)','wallpaper adjustment missing');
        qa.assert(JSON.stringify(JSON.parse(localStorage.getItem('motab_wallpaperSettings')))===JSON.stringify(settings),'wallpaper settings not stored');
        qa.assert(getComputedStyle(document.querySelector('.wallpaper-overlay')).backgroundColor==='rgba(0, 0, 0, 0.25)','dim not applied');`);
    await reload();
    await evaluate(`(async()=>{await qa.waitFor(()=>document.getElementById('wallpaper').style.backgroundImage.includes('blob:'),'wallpaper after reload');qa.assert(State.wallpaperSettings.x===30&&State.wallpaperSettings.dim===25,'wallpaper settings lost');})()`);
    results.push({name:'wallpaper media and adjustments survive reload',passed:true});
    console.log('PASS wallpaper media and adjustments survive reload');
    await test('portable v2 backup restores media and supports metadata undo', `
        const icon=await MotabMedia.putImage(await qa.imageFile(),{kind:'icon',x:50,y:50,zoom:1});
        State.shortcuts[0].children[0].iconAsset=icon; saveShortcuts();
        const exported=await createPortableBackup();
        qa.assert(exported.version===2&&exported.assets[icon],'v2 backup missing icon bytes');
        const previous=MotabData.validateData({...State,shortcuts:[{id:'qa-before',name:'导入前',url:'https://before.test/'}],dock:[],wallpaper:'lilac',wallpaperType:'static',wallpaperSettings:{...MotabData.DEFAULTS.wallpaperSettings}});
        MotabData.importBackup(localStorage,State,MotabData.makeBackup(previous,await MotabMedia.exportAssets(MotabData.assetIds(previous)))); applyStoredData();
        await MotabMedia.clear();qa.assert(await MotabMedia.getUrl(icon)===null,'portable restore fixture still has asset');
        await restorePortableBackup(exported); applyStoredData();
        qa.assert(State.shortcuts[0].children[0].iconAsset===icon&&await MotabMedia.getUrl(icon),'v2 restore lost custom image');
        const restored=new Image();restored.src=await MotabMedia.getUrl(icon);await restored.decode();qa.assert(restored.naturalWidth===256,'cold restored image cannot decode');
        MotabData.undoImport(localStorage); applyStoredData();
        qa.assert(State.shortcuts[0].id==='qa-before','restore undo wrong metadata');
        qa.assert(await MotabMedia.getUrl(icon),'undo removed reusable media');`);
    await test('legacy v1 backup supplies appearance defaults', `
        const legacy=structuredClone(MotabData.DEFAULTS); delete legacy.appearance;delete legacy.wallpaperSettings;
        const backup={format:'motab-backup',version:1,exportedAt:new Date().toISOString(),data:legacy};
        await restorePortableBackup(backup); applyStoredData();
        qa.assert(State.appearance.iconSize==='medium'&&State.wallpaperSettings.assetId===null,'legacy defaults missing');`);
    await test('corrupt portable media fails before replacing saved data', `
        const id=await MotabMedia.putImage(await qa.imageFile(),{kind:'icon',x:50,y:50,zoom:1});
        State.shortcuts[0].children[0].iconAsset=id; saveShortcuts(); const backup=await createPortableBackup();
        const before=JSON.stringify(MotabData.readStored(localStorage,MotabData.DEFAULTS).data); backup.assets[id]='data:image/png;base64,bm90LWFuLWltYWdl';
        let rejected=false;try{await restorePortableBackup(backup);}catch{rejected=true;}
        qa.assert(rejected,'corrupt media accepted');qa.assert(JSON.stringify(MotabData.readStored(localStorage,MotabData.DEFAULTS).data)===before,'failed restore changed saved data');`);
    await test('appearance drawer previews controls and Cancel restores the saved desktop', `
        const before=JSON.stringify(State.appearance), saved=localStorage.getItem('motab_appearance'), shape=State.iconShape;
        MotabAppearance.open('icons');
        const size=State.appearance.iconSize==='large'?'small':'large';
        document.querySelector('#appearance-panel [data-value="'+size+'"]').click();
        document.querySelector('#appearance-panel [data-value="dark"]').click();
        document.querySelector('#appearance-panel [data-value="4"]').click();
        const names=document.getElementById('appearance-show-names');names.checked=!State.appearance.showNames;names.dispatchEvent(new Event('change',{bubbles:true}));
        qa.assert(document.documentElement.dataset.iconStyle==='dark'&&document.documentElement.dataset.iconShape==='4','draft preview missing');
        qa.assert(JSON.stringify(State.appearance)===before&&localStorage.getItem('motab_appearance')===saved,'preview changed saved state');
        document.getElementById('appearance-cancel').click();
        qa.assert(!MotabAppearance.isOpen&&JSON.stringify(State.appearance)===before,'cancel changed state');
        qa.assert(document.documentElement.dataset.iconStyle===State.appearance.iconStyle&&document.documentElement.dataset.iconShape===String(shape),'cancel did not restore preview');`);
    await test('appearance drawer Apply commits size, style, names and tint', `
        MotabAppearance.open('icons');document.querySelector('#appearance-panel [data-value="large"]').click();
        document.querySelector('#appearance-panel [data-value="tinted"]').click();
        const names=document.getElementById('appearance-show-names');names.checked=false;names.dispatchEvent(new Event('change',{bubbles:true}));
        const tint=document.getElementById('appearance-tint');tint.value='#8ec5fc';tint.dispatchEvent(new Event('input',{bubbles:true}));
        document.getElementById('appearance-apply').click();await qa.waitFor(()=>!MotabAppearance.isOpen,'appearance apply');
        qa.assert(State.appearance.iconSize==='large'&&!State.appearance.showNames&&State.appearance.iconStyle==='tinted'&&State.appearance.tint.toLowerCase()==='#8ec5fc','drawer commit wrong');
        qa.assert(JSON.stringify(JSON.parse(localStorage.getItem('motab_appearance')))===JSON.stringify(State.appearance),'drawer not persisted');
        await persistAppearanceDraft({...State,appearance:{...MotabData.DEFAULTS.appearance}});`);
    await test('custom icon UI crops uploaded PNG and restores the website default', `
        State.dock=[{...State.shortcuts[0].children[0]}];saveShortcuts();saveDock();renderDock();
        customizeShortcutIcon(State.shortcuts[0].children[0]);qa.upload(document.getElementById('custom-icon-upload'),await qa.imageFile());
        await qa.waitFor(()=>document.querySelector('#custom-icon-panel canvas')&&document.getElementById('custom-icon-panel').getAttribute('aria-busy')==='false','icon upload decode');
        for(const [name,value] of [['x',100],['y',0],['zoom',2]]){const input=document.getElementById('custom-icon-'+name);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
        const preview=document.querySelector('#custom-icon-panel canvas').getContext('2d').getImageData(128,128,1,1).data;
        qa.assert(preview[0]===142&&preview[1]===197&&preview[2]===252,'crop preview wrong');
        document.getElementById('custom-icon-apply').click();await qa.waitFor(()=>!MotabAppearance.isOpen,'custom icon save');
        const item=State.shortcuts[0].children[0];qa.assert(item.iconAsset&&State.dock[0].iconAsset===item.iconAsset,'custom icon save not linked');
        const image=new Image();image.src=await MotabMedia.getUrl(item.iconAsset);await image.decode();
        const canvas=document.createElement('canvas');canvas.width=canvas.height=256;canvas.getContext('2d').drawImage(image,0,0);
        const saved=canvas.getContext('2d').getImageData(128,128,1,1).data;
        qa.assert(saved[0]===142&&saved[1]===197&&saved[2]===252,'saved crop differs from preview');
        customizeShortcutIcon(item);document.getElementById('custom-icon-reset').click();await qa.waitFor(()=>!MotabAppearance.isOpen,'restore website icon');
        qa.assert(!State.shortcuts[0].children[0].iconAsset&&!State.dock[0].iconAsset,'default icon not restored');
        qa.assert(!document.querySelector('.dock-item[data-id="qa-0"] .custom-icon-image'),'custom Dock image remains');`);
    await test('canceling a custom icon upload preserves item and linked Dock metadata', `
        State.dock=[{...State.shortcuts[0].children[0]}];saveShortcuts();saveDock();
        const before=JSON.stringify(snapshotForUndo()); customizeShortcutIcon(State.shortcuts[0].children[0]);
        qa.upload(document.getElementById('custom-icon-upload'),await qa.imageFile());
        await qa.waitFor(()=>document.querySelector('#custom-icon-panel canvas')&&document.getElementById('custom-icon-panel').getAttribute('aria-busy')==='false','icon upload');
        document.getElementById('custom-icon-cancel').click();qa.assert(!MotabAppearance.isOpen,'icon cancel did not close');
        qa.assert(JSON.stringify(snapshotForUndo())===before,'icon cancel modified metadata');`);
    await test('wallpaper drawer upload previews adjustments and Cancel restores saved wallpaper', `
        const before=JSON.stringify(State.wallpaperSettings),saved=localStorage.getItem('motab_wallpaperSettings');
        MotabAppearance.open('wallpaper');qa.upload(document.getElementById('appearance-wallpaper-upload'),await qa.imageFile('wallpaper.png'));
        await qa.waitFor(()=>document.getElementById('appearance-wallpaper-x')&&document.getElementById('appearance-panel').getAttribute('aria-busy')==='false','wallpaper upload');
        const input=document.getElementById('appearance-wallpaper-dim');input.value=45;input.dispatchEvent(new Event('input',{bubbles:true}));
        await qa.waitFor(()=>document.getElementById('wallpaper').style.backgroundImage.includes('blob:'),'wallpaper draft preview');
        qa.assert(JSON.stringify(State.wallpaperSettings)===before&&localStorage.getItem('motab_wallpaperSettings')===saved,'wallpaper preview committed');
        document.getElementById('appearance-cancel').click();await applyWallpaper();
        qa.assert(JSON.stringify(State.wallpaperSettings)===before,'wallpaper cancel changed settings');
        qa.assert(getComputedStyle(document.querySelector('.wallpaper-overlay')).backgroundColor==='rgba(0, 0, 0, '+State.wallpaperSettings.dim/100+')','wallpaper cancel left dim preview');`);
    await test('wallpaper drawer Apply stores uploaded image and crop controls', `
        MotabAppearance.open('wallpaper');qa.upload(document.getElementById('appearance-wallpaper-upload'),await qa.imageFile('wallpaper.png'));
        await qa.waitFor(()=>document.getElementById('appearance-wallpaper-x')&&document.getElementById('appearance-panel').getAttribute('aria-busy')==='false','wallpaper upload');
        for(const [name,value] of [['x',15],['y',85],['zoom',1.3],['blur',3],['dim',20]]){const input=document.getElementById('appearance-wallpaper-'+name);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
        document.getElementById('appearance-apply').click();await qa.waitFor(()=>!MotabAppearance.isOpen,'wallpaper apply');
        qa.assert(State.wallpaperSettings.assetId&&State.wallpaperSettings.x===15&&State.wallpaperSettings.y===85&&State.wallpaperSettings.zoom===1.3&&State.wallpaperSettings.blur===3&&State.wallpaperSettings.dim===20,'wallpaper UI settings wrong');
        qa.assert(JSON.stringify(JSON.parse(localStorage.getItem('motab_wallpaperSettings')))===JSON.stringify(State.wallpaperSettings),'wallpaper UI settings not persisted');`);
    await test('same-ID image conflicts preserve original resource and saved metadata', `
        const original=await MotabMedia.putImage(await qa.imageFile(),{kind:'icon'}),url=await MotabMedia.getUrl(original);
        const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,16,16);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        const other=await MotabMedia.putImage(new File([blob],'different.png',{type:'image/png'}),{kind:'icon'}),map=await MotabMedia.exportAssets([other]);
        const metadata=JSON.stringify(MotabData.readStored(localStorage,MotabData.DEFAULTS).data);let rejected=false;
        try{await MotabMedia.importAssets({[original]:map[other]});}catch{rejected=true;}
        qa.assert(rejected,'same ID overwritten');qa.assert(await MotabMedia.getUrl(original)===url,'original resource URL replaced');
        qa.assert(JSON.stringify(MotabData.readStored(localStorage,MotabData.DEFAULTS).data)===metadata,'media collision changed metadata');`);
    await test('stale asynchronous wallpaper preview cannot overwrite a newer selection', `
        await persistAppearanceDraft({...State,wallpaper:'lilac',wallpaperType:'static',wallpaperSettings:{...MotabData.DEFAULTS.wallpaperSettings}});
        const id=await MotabMedia.putImage(await qa.imageFile(),{kind:'wallpaper'}),url=await MotabMedia.getUrl(id),original=MotabMedia.getUrl;
        let release;const gate=new Promise(resolve=>{release=resolve;});
        try{MotabMedia.getUrl=asset=>asset===id?gate:original(asset);
            const pending=applyWallpaper({...State,wallpaperSettings:{...State.wallpaperSettings,assetId:id}});
            await applyWallpaper();release(url);await pending;
            qa.assert(document.getElementById('wallpaper').style.backgroundImage.includes('linear-gradient'),'stale preview replaced saved wallpaper');
        }finally{MotabMedia.getUrl=original;}
    `);
    await test('appearance controls isolate folder pagination and desktop context menus', `
        qa.open();await qa.finish();MotabAppearance.open('wallpaper');
        document.getElementById('appearance-wallpaper-dim').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
        qa.assert(folderPopupState.page===0,'appearance input paged folder');
        document.getElementById('appearance-panel').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:1100,clientY:300}));
        qa.assert(document.getElementById('layout-menu').hidden,'appearance contextmenu opened desktop menu');MotabAppearance.close();hideFolderPopup();await qa.finish();`);
    await evaluate('qa.reset(); saveShortcuts(); State.dock=[{...State.shortcuts[0].children[0]}]; saveDock();');
    const { targetId: syncTarget } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId: syncSession } = await command('Target.attachToTarget', { targetId: syncTarget, flatten: true });
    async function evaluateSync(expression) {
        const response=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},syncSession);
        if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||JSON.stringify(response.exceptionDetails));
        return response.result.value;
    }
    await command('Runtime.enable',{},syncSession);await command('Page.enable',{},syncSession);await command('Network.enable',{},syncSession);
    await command('Network.setBlockedURLs',{urls:['https://*']},syncSession);
    await command('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/startpage.html`},syncSession);
    for(let attempt=0;attempt<100;attempt++){
        try{if(await evaluateSync("typeof State!=='undefined'&&document.readyState==='complete'"))break;}catch{}
        await sleep(50);
    }
    await evaluateSync("for(let i=0;i<12;i++)iconFailedHosts.add('qa'+i+'.test');renderShortcuts();");
    const syncAsset=await evaluate(`(async()=>{
        const id=await MotabMedia.putImage(await qa.imageFile(),{kind:'icon'});State.shortcuts[0].children[0].iconAsset=id;
        saveShortcuts();reconcileDock();renderDock();
        await persistAppearanceDraft({...State,appearance:{...State.appearance,iconSize:'small',showNames:false,iconStyle:'dark'}});return id;
    })()`);
    let synced=false;
    for(let attempt=0;attempt<100;attempt++){
        synced=await evaluateSync(`State.appearance.iconSize==='small'&&State.shortcuts[0].children[0].iconAsset===${JSON.stringify(syncAsset)}&&State.dock[0].iconAsset===${JSON.stringify(syncAsset)}&&document.querySelector('.dock-item .custom-icon-image')?.naturalWidth===256`);
        if(synced)break;await sleep(30);
    }
    assert.equal(synced,true,'second tab did not synchronize appearance, shortcut, Dock and image');
    assert.equal(await evaluateSync("getComputedStyle(document.querySelector('.shortcut-item > .shortcut-icon')).width==='80px'&&getComputedStyle(document.querySelector('.shortcut-item > .shortcut-name')).display==='none'"),true,'second tab did not apply appearance CSS');
    results.push({name:'two tabs synchronize appearance, custom icon media and linked Dock',passed:true});console.log('PASS two tabs synchronize appearance, custom icon media and linked Dock');
    await command('Target.closeTarget',{targetId:syncTarget});
    await evaluate("MotabAppearance.open('icons'); qa.frame()");
    await evaluate(`(()=>{const panel=document.getElementById('appearance-panel'),r=panel.getBoundingClientRect();qa.assert(getComputedStyle(panel.parentElement).position==='fixed'&&getComputedStyle(panel).borderRadius==='26px','drawer CSS not loaded');qa.assert(qa.near(r.width,420)&&qa.near(r.right,innerWidth-22)&&r.height>300&&r.bottom<=innerHeight+1,'drawer outside right viewport');for(const anim of panel.getAnimations())anim.finish();})()`);
    await evaluate('qa.frame()');
    await cdp('Page.captureScreenshot', { format: 'png' }).then(image => fs.writeFile(path.join(output, 'appearance-icons.png'), Buffer.from(image.data, 'base64')));
    await evaluate("document.getElementById('appearance-tab-wallpaper').click(); qa.frame()");
    await cdp('Page.captureScreenshot', { format: 'png' }).then(image => fs.writeFile(path.join(output, 'appearance-wallpaper.png'), Buffer.from(image.data, 'base64')));
    await evaluate('MotabAppearance.close()');
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await evaluate("MotabAppearance.open('wallpaper'); qa.frame()");
    await evaluate(`(()=>{const panel=document.getElementById('appearance-panel');for(const anim of panel.getAnimations())anim.finish();const r=panel.getBoundingClientRect();qa.assert(r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,'mobile drawer overflows');qa.assert(getComputedStyle(panel).borderRadius==='22px','mobile drawer CSS missing');})()`);
    await evaluate('qa.frame()');
    await cdp('Page.captureScreenshot',{format:'png'}).then(image=>fs.writeFile(path.join(output,'appearance-wallpaper-mobile.png'),Buffer.from(image.data,'base64')));
    await evaluate('MotabAppearance.close()');
    results.push({name:'appearance drawer fits a narrow viewport',passed:true});console.log('PASS appearance drawer fits a narrow viewport');
    assert.equal(exceptions.length, 0, `Browser exceptions: ${JSON.stringify(exceptions)}`);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ browser: await command('Browser.getVersion'), results, exceptions }, null, 2));
    console.log(`All ${results.length} browser checks passed. Artifacts: ${output}`);
    await command('Browser.close').catch(() => {});
}

main().catch(async error => {
    console.error(error.stack || error);
    await fs.mkdir(output, { recursive: true }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ results, error: error.stack || String(error) }, null, 2)).catch(() => {});
    process.exitCode = 1;
}).finally(() => {
    socket?.close();
    if (browser && browser.exitCode === null) browser.kill();
    server?.close(); server?.closeAllConnections();
});
