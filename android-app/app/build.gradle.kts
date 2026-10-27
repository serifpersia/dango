plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Standalone app version, independent from the dango node project version.
val dangoVersionName = "1.1.2"
val dangoVersionCode = 13

val abiFlavors = mapOf(
    "arm64" to "arm64-v8a",
    "armv7" to "armeabi-v7a",
)

android {
    namespace = "com.serifpersia.dango"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.serifpersia.dango"
        minSdk = 26
        targetSdk = 35
        versionCode = dangoVersionCode
        versionName = dangoVersionName
    }

    flavorDimensions += "abi"
    productFlavors {
        abiFlavors.forEach { (flavor, abi) ->
            create(flavor) {
                dimension = "abi"
                ndk {
                    abiFilters.add(abi)
                }
            }
        }
    }

    signingConfigs {
        create("release") {
            storeFile = rootProject.file("dango-debug.keystore")
            storePassword = "dango123"
            keyAlias = "dango"
            keyPassword = "dango123"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        jniLibs.useLegacyPackaging = true
    }

    sourceSets {
        getByName("main") {
            jniLibs.srcDir(layout.buildDirectory.dir("generated/nodeLib"))
        }
        abiFlavors.keys.forEach { flavor ->
            maybeCreate(flavor).assets.srcDir(layout.buildDirectory.dir("generated/payload/$flavor/assets"))
        }
    }

    applicationVariants.all {
        val variant = this
        outputs.all {
            val abi = abiFlavors[variant.flavorName]
            if (abi != null) {
                val suffix = if (variant.buildType.name == "release") "" else "-${variant.buildType.name}"
                val output = this as? com.android.build.gradle.internal.api.BaseVariantOutputImpl
                output?.outputFileName = "com.serifpersia.dango-v${dangoVersionName}-$abi$suffix.apk"
            }
        }
    }
}

tasks.register("syncPayload") {
    val payloadDir = rootProject.projectDir.toPath().resolve("payload").toFile()
    val generatedPayloadDir = layout.buildDirectory.dir("generated/payload")
    description = "Copy Termux node payload into per-ABI APK assets"
    group = "dango"

    onlyIf { payloadDir.exists() }

    doLast {
        val generatedRoot = generatedPayloadDir.get().asFile
        generatedRoot.deleteRecursively()
        generatedRoot.mkdirs()

        val aliases = File(payloadDir, "aliases.txt")
            .takeIf { it.isFile }
            ?.readLines()
            ?.filter { it.isNotBlank() }
            .orEmpty()

        abiFlavors.forEach { (flavor, abi) ->
            val assetsDir = File(generatedRoot, "$flavor/assets")
            val payloadOut = File(assetsDir, "payload")
            payloadOut.mkdirs()

            val commonSrc = File(payloadDir, "common")
            if (commonSrc.exists()) {
                commonSrc.copyRecursively(File(payloadOut, "common"), overwrite = true)
            }

            val libSrc = File(payloadDir, "$abi/lib")
            if (libSrc.exists()) {
                libSrc.copyRecursively(File(payloadOut, "$abi/lib"), overwrite = true)
            }

            File(payloadOut, "aliases.txt").writeText(
                aliases.filter { it.startsWith("$abi/") }.joinToString("\n")
            )

            val files = payloadOut.walkTopDown()
                .filter { it.isFile && it.name != "manifest.txt" && !it.name.startsWith(".") && !it.name.startsWith("_") }
                .map { "payload/" + it.relativeTo(payloadOut).path.replace('\\', '/') }
                .sorted()
                .toList()
            File(payloadOut, "manifest.txt").writeText(files.joinToString("\n"))
            println("Payload synced for $flavor ($abi): ${files.size} files -> $assetsDir")
        }

        // Legacy generated assets must never be packaged; each flavor has its own copy.
        File(projectDir, "src/main/assets/payload").deleteRecursively()
    }
}

tasks.register("syncNodeBinary") {
    dependsOn("syncPayload")
    description = "Copy Termux node binaries into generated jniLibs as libnode.so"
    group = "dango"

    val generatedNodeLibDir = layout.buildDirectory.dir("generated/nodeLib")
    val payloadDir = rootProject.projectDir.toPath().resolve("payload").toFile()

    doFirst {
        generatedNodeLibDir.get().asFile.deleteRecursively()
        generatedNodeLibDir.get().asFile.mkdirs()
    }

    doLast {
        val destDir = generatedNodeLibDir.get().asFile
        var copiedAny = false

        for (abi in abiFlavors.values) {
            val nodeBin = File(payloadDir, "$abi/bin/node")
            if (nodeBin.exists()) {
                val targetDir = File(destDir, abi)
                targetDir.mkdirs()
                nodeBin.copyTo(File(targetDir, "libnode.so"), overwrite = true)
                println("Copied node binary for $abi -> ${targetDir}/libnode.so")
                copiedAny = true
            }
        }

        // Fallback for legacy single-arch payload structure
        val legacyNodeBin = File(payloadDir, "bin/node")
        if (!copiedAny && legacyNodeBin.exists()) {
            val targetDir = File(destDir, "arm64-v8a")
            targetDir.mkdirs()
            legacyNodeBin.copyTo(File(targetDir, "libnode.so"), overwrite = true)
            println("Copied legacy node binary -> ${targetDir}/libnode.so")
        }
    }
}

tasks.named("preBuild") {
    dependsOn("syncNodeBinary")
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
}
