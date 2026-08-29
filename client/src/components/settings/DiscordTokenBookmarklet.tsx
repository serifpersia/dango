import React, { useMemo } from 'react'
import { FaBookmark } from 'react-icons/fa'
import { Button } from '../common/Button'

function buildTokenBookmarklet(): string {
  const code = `(function(){
if(!/(^|\\.)discord\\.com$/.test(location.hostname)){alert('Dango: use this bookmarklet while on discord.com');return}
var t=null;
try{
window.webpackChunkdiscord_app.push([[Symbol()],{},function(req){
if(!req.c)return;
var ms=Object.values(req.c);
for(var i=0;i<ms.length;i++){var m=ms[i];
try{
if(!m.exports||m.exports===window)continue;
if(typeof m.exports.getToken==='function'){var x=m.exports.getToken();if(x){t=x;return}}
for(var k in m.exports){try{var ex=m.exports[k];if(ex&&typeof ex.getToken==='function'&&ex[Symbol.toStringTag]!=='IntlMessagesProxy'){var y=ex.getToken();if(y){t=y;return}}}catch(e1){}}
}catch(e2){}}
}]);
window.webpackChunkdiscord_app.pop();
}catch(e3){}
if(!t){alert('Dango: could not grab your token. Make sure you are logged in to Discord in this tab, then run the bookmarklet again.');return}
function copyFallback(){var a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{document.execCommand('copy')}catch(e4){}document.body.removeChild(a)}
var done=function(){window.close();setTimeout(function(){if(!window.closed){alert('Dango: token copied to clipboard! Could not close this tab, so just close it, go back to Dango Settings, paste the token and press Save.')}},250)};
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,function(){copyFallback();done()})}else{copyFallback();done()}
})()`

  return 'javascript:' + encodeURIComponent(code)
}

const DiscordTokenBookmarklet: React.FC = () => {
  const bookmarkletHref = useMemo(buildTokenBookmarklet, [])

  const handleBookmarkletClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    alert(
      'Drag this button onto your bookmarks bar instead of clicking it, then click it while you are on discord.com.'
    )
  }

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletHref)
      alert(
        'Bookmarklet code copied. Create a new bookmark on your bookmarks bar, name it "Dango Token" and paste the code as its URL.'
      )
    } catch {
      alert(
        'Could not copy automatically. Right-click the "Dango Token Grabber" button and choose "Copy link address" instead, then paste that into a new bookmark\'s URL.'
      )
    }
  }

  return (
    <div
      style={{
        marginTop: '0.9rem',
        paddingTop: '0.9rem',
        borderTop: '1px dashed var(--border-color)',
      }}
    >
      <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>
        Grab the token automatically (bookmarklet)
      </h4>
      <p
        style={{
          margin: '0 0 0.6rem',
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
        }}
      >
        Set this up once and you never have to dig through DevTools: the bookmarklet copies your
        Discord token to the clipboard and closes the Discord tab — then you just paste it above and
        press Save.
      </p>
      <ol
        style={{
          margin: '0 0 0.75rem',
          paddingLeft: '1.25rem',
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
          display: 'grid',
          gap: '0.3rem',
        }}
      >
        <li>
          Drag the <strong style={{ color: 'var(--text-primary)' }}>Dango Token Grabber</strong>{' '}
          button below onto your bookmarks bar (press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>{' '}
          first if the bar is hidden).
        </li>
        <li>
          Click <strong style={{ color: 'var(--text-primary)' }}>Open Discord</strong> and log in
          (skip this if you are already logged in).
        </li>
        <li>
          On the Discord tab, click the{' '}
          <strong style={{ color: 'var(--text-primary)' }}>Dango Token Grabber</strong> bookmark.
          The token lands in your clipboard and the tab closes on its own — come back here, paste it
          above and press <strong>Save</strong>.
        </li>
      </ol>
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <a
          href={bookmarkletHref}
          onClick={handleBookmarkletClick}
          title="Drag me to your bookmarks bar"
          draggable
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.4rem 0.8rem',
            borderRadius: '999px',
            border: '1px dashed var(--accent)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: '0.85rem',
            textDecoration: 'none',
            cursor: 'grab',
            userSelect: 'none',
          }}
        >
          <FaBookmark style={{ marginRight: '0.45rem', color: 'var(--accent)' }} />
          Dango Token Grabber
        </a>
        <a
          className="btn btn-secondary btn-sm"
          href="https://discord.com/channels/@me"
          target="_blank"
          rel="opener"
        >
          Open Discord
        </a>
        <Button variant="ghost" size="sm" onClick={handleCopyCode}>
          Copy code
        </Button>
      </div>
      <p
        style={{
          margin: '0.5rem 0 0',
          fontSize: '0.75rem',
          color: 'var(--text-tertiary)',
        }}
      >
        &quot;Copy code&quot; is a fallback for browsers that won&apos;t drag bookmarklets: create
        any bookmark, then paste the copied code as its URL.
      </p>
    </div>
  )
}

export default DiscordTokenBookmarklet
