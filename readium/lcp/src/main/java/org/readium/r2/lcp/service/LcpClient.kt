@file:OptIn(InternalReadiumApi::class)

package org.readium.r2.lcp.service

import java.lang.reflect.InvocationTargetException
import org.readium.r2.lcp.LcpError
import org.readium.r2.lcp.LcpException
import org.readium.r2.shared.InternalReadiumApi
import org.readium.r2.shared.extensions.tryOr

internal object LcpClient {

    data class Context(
        val hashedPassphrase: String,
        val encryptedContentKey: String,
        val token: String,
        val profile: String,
    ) {
        // Memoised: DRMContext is built from four immutable strings, so we only
        // need one per Context instance. Avoids reflective newInstance per decrypt.
        internal val drmContext: Any by lazy {
            drmContextConstructor.newInstance(
                hashedPassphrase,
                encryptedContentKey,
                token,
                profile
            )
        }

        companion object {
            fun fromDRMContext(drmContext: Any): Context {
                val encryptedContentKey = getEncryptedContentKey.invoke(drmContext) as String
                val hashedPassphrase = getHashedPassphrase.invoke(drmContext) as String
                val profile = getProfile.invoke(drmContext) as String
                val token = getToken.invoke(drmContext) as String
                return Context(hashedPassphrase, encryptedContentKey, token, profile)
            }
        }
    }

    private val klass: Class<*> by lazy { Class.forName("org.readium.lcp.sdk.Lcp") }
    private val instance: Any by lazy { klass.getDeclaredConstructor().newInstance() }

    private val drmContextClass: Class<*> by lazy { Class.forName("org.readium.lcp.sdk.DRMContext") }
    private val drmExceptionClass: Class<*> by lazy { Class.forName("org.readium.lcp.sdk.DRMException") }
    private val drmErrorClass: Class<*> by lazy { Class.forName("org.readium.lcp.sdk.DRMError") }

    private val drmContextConstructor by lazy {
        drmContextClass.getConstructor(
            String::class.java,
            String::class.java,
            String::class.java,
            String::class.java
        )
    }
    private val getEncryptedContentKey by lazy { drmContextClass.getMethod("getEncryptedContentKey") }
    private val getHashedPassphrase by lazy { drmContextClass.getMethod("getHashedPassphrase") }
    private val getProfile by lazy { drmContextClass.getMethod("getProfile") }
    private val getToken by lazy { drmContextClass.getMethod("getToken") }

    private val createContextMethod by lazy {
        klass.getMethod(
            "createContext",
            String::class.java,
            String::class.java,
            String::class.java
        )
    }
    private val decryptMethod by lazy {
        klass.getMethod("decrypt", drmContextClass, ByteArray::class.java)
    }
    private val findOneValidPassphraseMethod by lazy {
        klass.getMethod("findOneValidPassphrase", String::class.java, Array<String>::class.java)
    }
    private val getDrmErrorMethod by lazy { drmExceptionClass.getMethod("getDrmError") }
    private val getCodeMethod by lazy { drmErrorClass.getMethod("getCode") }

    fun isAvailable(): Boolean = tryOr(false) {
        instance
        true
    }

    fun createContext(jsonLicense: String, hashedPassphrases: String, pemCrl: String): Context =
        try {
            val drmContext = createContextMethod
                .invoke(instance, jsonLicense, hashedPassphrases, pemCrl)!!
            Context.fromDRMContext(drmContext)
        } catch (e: InvocationTargetException) {
            throw mapException(e.targetException)
        }

    fun decrypt(context: Context, encryptedData: ByteArray): ByteArray =
        try {
            decryptMethod.invoke(instance, context.drmContext, encryptedData) as ByteArray
        } catch (e: InvocationTargetException) {
            throw mapException(e.targetException)
        }

    fun findOneValidPassphrase(jsonLicense: String, hashedPassphrases: List<String>): String =
        try {
            findOneValidPassphraseMethod
                .invoke(instance, jsonLicense, hashedPassphrases.toTypedArray()) as String
        } catch (e: InvocationTargetException) {
            throw mapException(e.targetException)
        }

    private fun mapException(e: Throwable): LcpException {
        if (!drmExceptionClass.isInstance(e)) {
            return LcpException(LcpError.Runtime("the Lcp client threw an unhandled exception"))
        }

        val drmError = getDrmErrorMethod.invoke(e)
        val errorCode = getCodeMethod.invoke(drmError) as Int

        val error = when (errorCode) {
            // Error code 11 should never occur since we check the start/end date before calling createContext
            11 -> LcpError.Runtime("License is out of date (check start and end date).")
            101 -> LcpError.LicenseIntegrity.CertificateRevoked
            102 -> LcpError.LicenseIntegrity.InvalidCertificateSignature
            111 -> LcpError.LicenseIntegrity.InvalidLicenseSignatureDate
            112 -> LcpError.LicenseIntegrity.InvalidLicenseSignature
            // Error code 121 seems to be unused in the C++ lib.
            121 -> LcpError.Runtime("The drm context is invalid.")
            131 -> LcpError.Decryption.ContentKeyDecryptError
            141 -> LcpError.LicenseIntegrity.InvalidUserKeyCheck
            151 -> LcpError.Decryption.ContentDecryptError
            else -> LcpError.Unknown(e)
        }

        return LcpException(error)
    }
}
