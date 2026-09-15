const ext = typeof browser !== 'undefined' ? browser : chrome

window.addEventListener('dango:get-pahe-cookie', async () => {
  try {
    const reply = await ext.runtime.sendMessage({ type: 'GET_PAHE_COOKIE' })
    window.dispatchEvent(new CustomEvent('dango:pahe-cookie', { detail: JSON.stringify(reply) }))
  } catch (e) {
    window.dispatchEvent(
      new CustomEvent('dango:pahe-cookie', {
        detail: JSON.stringify({ ok: false, error: String((e && e.message) || e) }),
      })
    )
  }
})
