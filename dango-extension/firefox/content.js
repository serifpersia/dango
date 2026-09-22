const ext = typeof browser !== 'undefined' ? browser : chrome

const bridge = (getEvent, replyEvent, type) => {
  window.addEventListener(getEvent, async () => {
    try {
      const reply = await ext.runtime.sendMessage({ type })
      window.dispatchEvent(new CustomEvent(replyEvent, { detail: JSON.stringify(reply) }))
    } catch (e) {
      window.dispatchEvent(
        new CustomEvent(replyEvent, {
          detail: JSON.stringify({ ok: false, error: String((e && e.message) || e) }),
        })
      )
    }
  })
}

bridge('dango:get-pahe-cookie', 'dango:pahe-cookie', 'GET_PAHE_COOKIE')
bridge('dango:get-jasmr-cookie', 'dango:jasmr-cookie', 'GET_JASMR_COOKIE')
