const fs = require('fs')
const path = require('path')

const newVersion = process.argv[2]

if (!newVersion) {
  console.error('❌ Provide version like: 1.2.3')
  process.exit(1)
}

const root = process.cwd()

const targets = [
  path.join(root, 'package.json'),
  path.join(root, 'client', 'package.json'),
  path.join(root, 'server', 'package.json'),

  path.join(root, 'package-lock.json'),

  path.join(root, 'README.md'),
]

function updateFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Skipping missing file: ${filePath}`)
    return
  }

  const content = fs.readFileSync(filePath, 'utf8')

  if (filePath.endsWith('.json')) {
    const json = JSON.parse(content)
    let updated = false

    if (json.version) {
      json.version = newVersion
      updated = true
    }

    if (json.packages && json.packages['']) {
      json.packages[''].version = newVersion
      updated = true
    }

    if (filePath.endsWith('package.json') && filePath === path.join(root, 'package.json')) {
      json.versionDate = new Date().toISOString()
      updated = true
    }

    if (updated) {
      fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n')
      console.log(`✅ Updated ${filePath}`)
    }
  } else if (filePath.endsWith('.md')) {
    const badgeRegex = /img\.shields\.io\/badge\/dango-(\d+\.\d+\.\d+)-/
    const newContent = content.replace(badgeRegex, `img.shields.io/badge/dango-${newVersion}-`)

    if (content !== newContent) {
      fs.writeFileSync(filePath, newContent)
      console.log(`✅ Updated ${filePath}`)
    }
  }
}

targets.forEach(updateFile)

console.log(`🎉 Version bumped to ${newVersion}`)
