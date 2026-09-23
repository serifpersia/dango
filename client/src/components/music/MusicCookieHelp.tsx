import React from 'react'

const MusicCookieHelp: React.FC = () => {
  return (
    <div
      style={{
        marginTop: '0.9rem',
        paddingTop: '0.9rem',
        borderTop: '1px dashed var(--border-color)',
      }}
    >
      <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>Where to get the cookie</h4>
      <p
        style={{
          margin: '0 0 0.6rem',
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
        }}
      >
        Google marks its login cookies unreadable to page scripts, so this has to come from DevTools
        — it takes about 20 seconds:
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
          Open{' '}
          <a href="https://music.youtube.com/" target="_blank" rel="noopener noreferrer">
            music.youtube.com
          </a>{' '}
          and make sure you are logged in.
        </li>
        <li>
          Press <kbd>F12</kbd>, go to the <strong>Network</strong> tab, and type <kbd>browse</kbd>{' '}
          in the filter box.
        </li>
        <li>
          Click any <kbd>POST</kbd> browse entry, then scroll to Request Headers.
        </li>
        <li>
          <strong>Right-click</strong> the <kbd>Cookie</kbd> value and choose{' '}
          <strong>Copy value</strong> — right-click copies the full unwrapped value, selecting the
          text by hand truncates it.
        </li>
        <li>Paste it into the sign-in box above and press Sign in.</li>
      </ol>
    </div>
  )
}

export default MusicCookieHelp
