import React from 'react'
import Icon from '../common/Icon'
import { MenuSlider } from './MenuControls'
import { AMBIENT_DEFAULTS, type AmbientLightSettings } from '../../hooks/useAmbientLight'

interface AmbientLightMenuProps {
  classes: { item: string; active: string; note: string }
  values: AmbientLightSettings
  onChange: (patch: Partial<AmbientLightSettings>) => void
}

const AmbientLightMenu: React.FC<AmbientLightMenuProps> = ({ classes, values, onChange }) => (
  <>
    <button
      type="button"
      className={`${classes.item} ${values.enabled ? classes.active : ''}`}
      onClick={() => onChange({ enabled: !values.enabled })}
      aria-pressed={values.enabled}
    >
      <span>Ambient light</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {values.enabled ? 'On' : 'Off'}
        {values.enabled && <Icon name="check" size={12} />}
      </span>
    </button>
    <MenuSlider
      label="Blur"
      display={`${values.blur}px`}
      min={0}
      max={120}
      step={2}
      value={values.blur}
      percent={(values.blur / 120) * 100}
      onChange={(v) => onChange({ blur: Math.round(v) })}
    />
    <MenuSlider
      label="Saturation"
      display={`${values.saturation}%`}
      min={0}
      max={200}
      step={5}
      value={values.saturation}
      percent={(values.saturation / 200) * 100}
      onChange={(v) => onChange({ saturation: Math.round(v) })}
    />
    <MenuSlider
      label="Brightness"
      display={`${values.brightness}%`}
      min={20}
      max={120}
      step={5}
      value={values.brightness}
      percent={((values.brightness - 20) / 100) * 100}
      onChange={(v) => onChange({ brightness: Math.round(v) })}
    />
    <MenuSlider
      label="Opacity"
      display={`${values.opacity}%`}
      min={10}
      max={100}
      step={5}
      value={values.opacity}
      percent={((values.opacity - 10) / 90) * 100}
      onChange={(v) => onChange({ opacity: Math.round(v) })}
    />
    <div className={classes.note}>
      Mirrors the video onto the backdrop behind the player. Turn off for pure black.
    </div>
    <button
      type="button"
      className={classes.item}
      onClick={() => onChange({ ...AMBIENT_DEFAULTS })}
    >
      <span>Reset to defaults</span>
    </button>
  </>
)

export default AmbientLightMenu
