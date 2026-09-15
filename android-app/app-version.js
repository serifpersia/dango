// Prints the standalone Android app version (dangoVersionName in app/build.gradle.kts).
const fs = require('fs')
const path = require('path')

const gradleFile = path.join(__dirname, 'app', 'build.gradle.kts')
const text = fs.readFileSync(gradleFile, 'utf8')
const match = text.match(/dangoVersionName\s*=\s*"([^"]+)"/)
if (!match) {
  console.error('dangoVersionName not found in app/build.gradle.kts')
  process.exit(1)
}
console.log(match[1])
