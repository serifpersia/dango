import { execSync } from 'child_process'
import os from 'os'
import crypto from 'crypto'
import fs from 'fs'

export function getMachineId(): string {
  let hardwareId = ''
  try {
    if (process.platform === 'win32') {
      hardwareId = execSync(
        'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid'
      )
        .toString()
        .split('REG_SZ')[1]
        .trim()
    } else if (process.platform === 'linux') {
      if (fs.existsSync('/etc/machine-id')) {
        hardwareId = fs.readFileSync('/etc/machine-id', 'utf8').trim()
      } else if (fs.existsSync('/var/lib/dbus/machine-id')) {
        hardwareId = fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim()
      }
    } else if (process.platform === 'darwin') {
      hardwareId = execSync(
        "ioreg -rd1 -c IOPlatformExpertDevice | grep -E 'IOPlatformUUID' | awk -F'\"' '{print $4}'"
      )
        .toString()
        .trim()
    }
  } catch (err) {
    const interfaces = os.networkInterfaces()
    const macs = Object.values(interfaces)
      .flat()
      .flatMap((iface) =>
        iface && !iface.internal && iface.mac !== '00:00:00:00:00:00' ? [iface.mac] : []
      )
      .sort()
    hardwareId = macs.length > 0 ? macs.join('-') : os.hostname()
  }

  const username = os.userInfo().username
  const seed = `${hardwareId}:${username}:${process.platform}`

  return crypto.createHash('sha256').update(seed).digest('hex')
}
