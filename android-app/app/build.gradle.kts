plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.serifpersia.dango"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.serifpersia.dango"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        ndk {
            abiFilters.addAll(listOf("arm64-v8a", "armeabi-v7a"))
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

    sourceSets {
        getByName("main") {
            assets.srcDirs("src/main/assets")
            jniLibs.srcDir(layout.buildDirectory.dir("generated/nodeLib"))
        }
    }

    applicationVariants.all {
        outputs.all {
            val output = this as? com.android.build.gradle.internal.api.BaseVariantOutputImpl
            if (buildType.name == "release") {
                output?.outputFileName = "com.serifpersia.dango-universal.apk"
            } else if (buildType.name == "debug") {
                output?.outputFileName = "com.serifpersia.dango-universal-debug.apk"
            }
        }
    }
}

tasks.register("syncPayload") {
    val payloadDir = rootProject.projectDir.toPath().resolve("payload").toFile()
    val assetsPayloadDir = projectDir.toPath().resolve("src/main/assets/payload").toFile()
    description = "Copy Termux node payload into APK assets"
    group = "dango"

    onlyIf { payloadDir.exists() }

    doLast {
        assetsPayloadDir.deleteRecursively()
        assetsPayloadDir.mkdirs()
        payloadDir.copyRecursively(assetsPayloadDir, overwrite = true)
        
        // Remove only ABI bin directories since node binary is packaged via jniLibs as libnode.so
        // (Do NOT delete common/npm/bin!)
        listOf("arm64-v8a", "armeabi-v7a").forEach { abi ->
            File(assetsPayloadDir, "$abi/bin").deleteRecursively()
        }
        File(assetsPayloadDir, "bin").deleteRecursively()
        
        println("Payload synced: ${payloadDir} -> ${assetsPayloadDir}")
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
        val abis = listOf("arm64-v8a", "armeabi-v7a")
        var copiedAny = false

        for (abi in abis) {
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

tasks.register("generateManifest") {
    val assetsPayloadDir = projectDir.toPath().resolve("src/main/assets/payload").toFile()
    val manifestFile = assetsPayloadDir.resolve("manifest.txt")
    description = "Generate manifest.txt listing all payload files (workaround for assets.list() __-prefix bug)"
    group = "dango"

    dependsOn("syncPayload")
    inputs.dir(assetsPayloadDir)
    outputs.file(manifestFile)

    doLast {
        val files = assetsPayloadDir.walkTopDown()
            .filter { it.isFile && it.name != "manifest.txt" && !it.name.startsWith(".") && !it.name.startsWith("_") }
            .map { "payload/" + it.relativeTo(assetsPayloadDir).path.replace('\\', '/') }
            .sorted()
            .toList()
        manifestFile.writeText(files.joinToString("\n"))
        println("Manifest generated: ${files.size} files -> $manifestFile")
    }
}

tasks.named("preBuild") {
    dependsOn("syncNodeBinary")
    dependsOn("generateManifest")
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
