/*
 * RallyReader fork patch.
 *
 * Self-contained DNS-over-HTTPS fallback resolver for the LCP publication download. It is duplicated
 * here (rather than shared with the app module) so the patch stays isolated and easy to re-apply
 * across upstream Readium merges. Keep in sync with com.rallyreader.app.network.DohFallbackDns.
 */

package org.readium.r2.lcp.service

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps

/**
 * An OkHttp [Dns] that resolves through the system resolver first and only falls back to
 * DNS-over-HTTPS when the system resolver throws [UnknownHostException]. This stops the encrypted
 * publication download from failing when the device's configured DNS cannot resolve the host.
 *
 * Scoped to the (first-party) publication-download client only, so a locally-blocked host is never
 * silently re-resolved through Cloudflare.
 */
internal class DohFallbackDns(
    private val systemDns: Dns = Dns.SYSTEM,
    private val dohDnsProvider: () -> Dns,
) : Dns {

    override fun lookup(hostname: String): List<InetAddress> =
        try {
            systemDns.lookup(hostname)
        } catch (systemError: UnknownHostException) {
            lookupViaDohOrNull(hostname) ?: throw systemError
        }

    private fun lookupViaDohOrNull(hostname: String): List<InetAddress>? =
        try {
            dohDnsProvider().lookup(hostname).ifEmpty { null }
        } catch (dohError: Exception) {
            null
        }
}

/**
 * Returns a shared [Dns] that resolves via the system resolver first and falls back to Cloudflare
 * DoH. The DoH resolver and its plain bootstrap client are built lazily, exactly once, on first
 * fallback. The DoH endpoint is addressed by its literal IP so resolving it never depends on the
 * system DNS.
 */
private val sharedDohDns: Dns by lazy {
    val dohResolver = lazy {
        DnsOverHttps.Builder()
            .client(OkHttpClient.Builder().build())
            .url("https://1.1.1.1/dns-query".toHttpUrl())
            .bootstrapDnsHosts(
                InetAddress.getByName("1.1.1.1"),
                InetAddress.getByName("1.0.0.1"),
            )
            .build()
    }
    DohFallbackDns(dohDnsProvider = { dohResolver.value })
}

internal fun systemThenDohDns(): Dns = sharedDohDns
