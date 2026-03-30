import { getResolvedApiBaseUrl } from './client'

/**
 * Импорт Excel с потоком NDJSON: прогресс по строкам на сервере + onUploadProgress при отправке файла.
 * Возвращает Promise с тем же видом, что axios: { data: { created, skipped } }.
 */
export function importExcelStream(file, options = {}) {
  const { signal, onUploadProgress, onServerProgress } = options
  const url = `${getResolvedApiBaseUrl()}/products/import/excel/stream`

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    const token = localStorage.getItem('authToken')
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }

    let carry = ''
    let lastLen = 0
    let settled = false

    const settle = (fn) => {
      if (settled) return
      settled = true
      fn()
    }

    const handleLine = (line) => {
      const t = line.trim()
      if (!t) return
      let obj
      try {
        obj = JSON.parse(t)
      } catch {
        return
      }
      if (obj.type === 'progress') {
        onServerProgress?.(obj.current ?? 0, obj.total ?? 0)
      } else if (obj.type === 'complete') {
        settle(() => resolve({ data: { created: obj.created ?? 0, skipped: obj.skipped || [] } }))
      } else if (obj.type === 'error') {
        settle(() => reject(Object.assign(new Error(obj.message || 'Ошибка импорта'), { isImportStreamError: true })))
      }
    }

    const drain = () => {
      const text = xhr.responseText || ''
      const chunk = text.slice(lastLen)
      lastLen = text.length
      carry += chunk
      const parts = carry.split('\n')
      carry = parts.pop() ?? ''
      for (const p of parts) {
        handleLine(p)
      }
    }

    const finish = () => {
      drain()
      if (carry.trim()) {
        handleLine(carry)
        carry = ''
      }
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onUploadProgress?.({ loaded: e.loaded, total: e.total })
      } else {
        onUploadProgress?.({ loaded: e.loaded, total: 0 })
      }
    }

    xhr.onprogress = () => {
      drain()
    }

    xhr.onload = () => {
      if (xhr.status === 401) {
        localStorage.removeItem('authToken')
        localStorage.removeItem('user')
        window.dispatchEvent(new CustomEvent('auth:logout'))
        window.location.href = '/login'
        settle(() => reject(Object.assign(new Error('Не авторизован'), { code: 'ERR_UNAUTHORIZED' })))
        return
      }

      finish()
      if (settled) return

      if (xhr.status < 200 || xhr.status >= 300) {
        let detail = xhr.responseText || `Ошибка ${xhr.status}`
        try {
          const j = JSON.parse(xhr.responseText)
          if (typeof j?.detail === 'string') detail = j.detail
        } catch {
          /* keep text */
        }
        settle(() =>
          reject(
            Object.assign(new Error(detail), {
              response: { status: xhr.status, data: { detail } },
            }),
          ),
        )
        return
      }

      settle(() => reject(new Error('Сервер не прислал итог импорта (обрыв ответа)')))
    }

    xhr.onerror = () => {
      settle(() =>
        reject(
          Object.assign(new Error('Network Error'), {
            response: { status: 0, data: { detail: 'Нет связи с сервером' } },
          }),
        ),
      )
    }

    xhr.onabort = () => {
      const err = new Error('canceled')
      err.code = 'ERR_CANCELED'
      settle(() => reject(err))
    }

    if (signal) {
      if (signal.aborted) {
        xhr.abort()
        return
      }
      const onAbort = () => xhr.abort()
      signal.addEventListener('abort', onAbort)
      xhr.addEventListener('loadend', () => signal.removeEventListener('abort', onAbort), { once: true })
    }

    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}
