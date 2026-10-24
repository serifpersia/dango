export const invitePage = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join a dango watch-along</title>
<style>
body{color:#eee;background:#15151b;font:16px system-ui;margin:0;padding:24px}main{max-width:440px;margin:12vh auto}h1{font-size:28px}p{line-height:1.6;color:#c5c5d0}input,button{box-sizing:border-box;width:100%;padding:14px;border-radius:10px;font:inherit;margin:8px 0}input{background:#24242d;border:1px solid #666;color:#fff}button{background:#baafff;color:#171322;border:0;cursor:pointer}label{display:block;margin-top:24px}#error{color:#ffb4b4}
</style>
<main><h1>Watch together on dango</h1><p>Open this invite in your own dango. The host chooses what plays and controls playback. Your server streams the video.</p>
<label for="address">Your dango address</label><input id="address" type="url" placeholder="http://localhost:3000" autocomplete="url">
<button id="open">Open in my dango</button><p id="error" role="alert"></p><p>You can also paste this invite into Watch along in dango's menu. Anyone with the invite can join.</p></main>
<script>
const address=document.getElementById('address'), error=document.getElementById('error');
try { address.value=localStorage.getItem('dango-address')||'' } catch {}
document.getElementById('open').onclick=()=>{
try {
if(!/^#[0-9a-f-]{36}\\.[0-9a-f]{64}$/.test(location.hash)) throw Error('This invite is incomplete. Ask the host for a new link.');
const url=new URL(address.value);
if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw Error('Enter a valid HTTP or HTTPS dango address.');
try { localStorage.setItem('dango-address',url.origin) } catch {}
url.pathname='/watch-along';url.search='';url.hash=location.hash;
location.assign(url.href);
} catch(e) { error.textContent=e.message }
};
</script></html>`
