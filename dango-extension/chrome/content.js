const ext = typeof browser !== 'undefined' ? browser : chrome

const bridge = (getEvent, replyEvent, type) => {
  window.addEventListener(getEvent, async (e) => {
    let requestId = null
    try {
      const raw = e && e.detail
      requestId =
        typeof raw === 'string' ? (JSON.parse(raw)?.requestId ?? null) : (raw?.requestId ?? null)
    } catch {
      requestId = null
    }
    try {
      const reply = await ext.runtime.sendMessage({ type })
      window.dispatchEvent(
        new CustomEvent(replyEvent, { detail: JSON.stringify({ ...reply, requestId }) })
      )
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent(replyEvent, {
          detail: JSON.stringify({
            ok: false,
            error: String((err && err.message) || err),
            requestId,
          }),
        })
      )
    }
  })
}

bridge('dango:get-pahe-cookie', 'dango:pahe-cookie', 'GET_PAHE_COOKIE')
bridge('dango:get-jasmr-cookie', 'dango:jasmr-cookie', 'GET_JASMR_COOKIE')
bridge('dango:get-ytmusic-cookie', 'dango:ytmusic-cookie', 'GET_YTMUSIC_COOKIE')
