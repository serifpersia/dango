# Reusable player

`createPlayerEngine` owns media state, transport, source replacement, HLS/native
playback, track selection, and cleanup. `usePlayerCore` manages its React lifetime.
Pages keep provider queries, progress persistence, playlists, and custom panels.

```tsx
import { usePlayerCore } from './usePlayerCore'
import PlayerSurface from '../../components/player/PlayerSurface'
import { PlayerVideo } from '../../components/player/PlayerMedia'
import {
  PlayPauseButton,
  SeekSlider,
  FullscreenButton,
} from '../../components/player/PlaybackControls'

function WatchPage({ url }: { url: string }) {
  const { engine } = usePlayerCore()
  return (
    <PlayerSurface
      engine={engine}
      bottomBar={
        <>
          <PlayPauseButton />
          <SeekSlider />
          <FullscreenButton />
        </>
      }
    >
      <PlayerVideo source={{ url, hls: true }} sourceOptions={{ autoPlay: true }} />
    </PlayerSurface>
  )
}
```

`PlayerSurface` supplies the provider, desktop/mobile input, controls visibility,
fullscreen layout, and playback errors. Its slots accept custom components.
For an audio layout, use `PlayerProvider` with `PlayerAudio` and the same controls.
Use `usePlayerInput` for shortcuts in a custom surface.

`usePlayerState` subscribes to playback/control state. `usePlayerTimeline` subscribes
separately to time and buffering so progress updates do not redraw the page.
`TrackSelector` supports audio, subtitles, and HLS quality; `PlayerVolume` and
`VolumeSlider` expose the same volume state in different layouts.

Pages needing provider-specific HLS configuration can call `engine.loadSource`
inside an effect and return its disposer. Use either that adapter or the media
component's `source` prop for a media element, so only one path owns its source.
`onHls` installs provider-specific track preferences before loading starts.

Provider iframes remain isolated: their playback belongs to the embedded provider.
Native video/audio and HLS use the shared engine.
