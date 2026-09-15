const fs = require('fs')
const path = require('path')

const rootPkgPath = path.join(__dirname, 'package.json')
const serverPkgPath = path.join(__dirname, 'server', 'package.json')

const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'))
const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf8'))

const sortKeys = (obj) =>
  Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, obj[k]])
  )

const serverDeps = sortKeys(serverPkg.dependencies || {})
const rootDeps = sortKeys(rootPkg.dependencies || {})

if (JSON.stringify(serverDeps) === JSON.stringify(rootDeps)) {
  console.log('Root dependencies already in sync with server.')
  return
}

rootPkg.dependencies = serverDeps
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n')
console.log('Synced root dependencies from server/package.json.')
