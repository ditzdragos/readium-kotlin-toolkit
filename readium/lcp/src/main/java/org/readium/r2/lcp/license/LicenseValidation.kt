/*
 * Module: r2-lcp-kotlin
 * Developers: Aferdita Muriqi
 *
 * Copyright (c) 2019. Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license which is detailed in the
 * LICENSE file present in the project repository where this source code is maintained.
 */

package org.readium.r2.lcp.license

import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.runBlocking
import org.readium.r2.lcp.BuildConfig.DEBUG
import org.readium.r2.lcp.LcpAuthenticating
import org.readium.r2.lcp.LcpError
import org.readium.r2.lcp.LcpException
import org.readium.r2.lcp.license.model.LicenseDocument
import org.readium.r2.lcp.license.model.StatusDocument
import org.readium.r2.lcp.license.model.components.Link
import org.readium.r2.lcp.service.CRLService
import org.readium.r2.lcp.service.DeviceService
import org.readium.r2.lcp.service.LcpClient
import org.readium.r2.lcp.service.NetworkService
import org.readium.r2.lcp.service.PassphrasesService
import org.readium.r2.shared.util.Instant
import org.readium.r2.shared.util.getOrElse
import org.readium.r2.shared.util.mediatype.MediaType
import timber.log.Timber

internal sealed class Either<A, B> {
    class Left<A, B>(val left: A) : Either<A, B>()
    class Right<A, B>(val right: B) : Either<A, B>()
}

private val supportedProfiles = listOf(
    "http://readium.org/lcp/basic-profile",
    "http://readium.org/lcp/profile-1.0",
    "http://readium.org/lcp/profile-2.0",
    "http://readium.org/lcp/profile-2.1",
    "http://readium.org/lcp/profile-2.2",
    "http://readium.org/lcp/profile-2.3",
    "http://readium.org/lcp/profile-2.4",
    "http://readium.org/lcp/profile-2.5",
    "http://readium.org/lcp/profile-2.6",
    "http://readium.org/lcp/profile-2.7",
    "http://readium.org/lcp/profile-2.8",
    "http://readium.org/lcp/profile-2.9"
)

internal typealias Context = Either<LcpClient.Context, LcpError.LicenseStatus>

internal typealias Observer = (ValidatedDocuments?, Exception?) -> Unit

private var observers: MutableList<Pair<Observer, ObserverPolicy>> = mutableListOf()

internal enum class ObserverPolicy {
    Once,
    Always,
}

internal data class ValidatedDocuments constructor(
    val license: LicenseDocument,
    private val context: Context,
    val status: StatusDocument? = null,
) {
    fun getContext(): LcpClient.Context {
        when (context) {
            is Either.Left -> return context.left
            is Either.Right -> throw LcpException(context.right)
        }
    }
}

internal sealed class State {
    object start : State()
    data class validateLicense(val data: ByteArray, val status: StatusDocument?) : State()
    data class fetchStatus(val license: LicenseDocument) : State()
    data class validateStatus(val license: LicenseDocument, val data: ByteArray) : State()
    data class fetchLicense(val license: LicenseDocument, val status: StatusDocument) : State()
    data class checkLicenseStatus(
        val license: LicenseDocument,
        val status: StatusDocument?,
        val statusDocumentTakesPrecedence: Boolean,
    ) : State()
    data class retrievePassphrase(val license: LicenseDocument, val status: StatusDocument?) : State()
    data class validateIntegrity(
        val license: LicenseDocument,
        val status: StatusDocument?,
        val passphrase: String,
    ) : State()
    data class registerDevice(val documents: ValidatedDocuments, val link: Link) : State()
    data class valid(val documents: ValidatedDocuments) : State()
    data class failure(val error: Exception) : State()
    object cancelled : State()
}

internal sealed class Event {
    data class retrievedLicenseData(val data: ByteArray) : Event()
    data class validatedLicense(val license: LicenseDocument) : Event()
    data class retrievedStatusData(val data: ByteArray) : Event()
    data class validatedStatus(val status: StatusDocument) : Event()
    data class checkedLicenseStatus(val error: LcpError.LicenseStatus?) : Event()
    data class retrievedPassphrase(val passphrase: String) : Event()
    data class validatedIntegrity(val context: LcpClient.Context) : Event()
    data class registeredDevice(val statusData: ByteArray?) : Event()
    data class failed(val error: Exception) : Event()
    object cancelled : Event()
}

/**
 * If [ignoreInternetErrors] is true, then the validation won't fail on [LcpError.Network] errors.
 * This should be the case with writable licenses (such as local ones) but not with read-only licences.
 */
internal class LicenseValidation(
    var authentication: LcpAuthenticating?,
    val allowUserInteraction: Boolean,
    val ignoreInternetErrors: Boolean,
    val crl: CRLService,
    val device: DeviceService,
    val network: NetworkService,
    val passphrases: PassphrasesService,
    val context: android.content.Context,
    val onLicenseValidated: (LicenseDocument) -> Unit,
) {

    var state: State = State.start
        set(newValue) {
            field = newValue
            handle(state)
        }

    sealed class Document {
        data class license(val data: ByteArray) : Document()
        data class status(val data: ByteArray) : Document()
    }

    fun validate(document: Document, completion: Observer) {
        val event: Event = when (document) {
            is Document.license -> Event.retrievedLicenseData(document.data)
            is Document.status -> Event.retrievedStatusData(document.data)
        }
        observe(event, completion)
    }

    val isProduction: Boolean = {
        val prodLicenseInput = context.assets.open("prod-license.lcpl")
        val prodLicense = LicenseDocument(data = prodLicenseInput.readBytes())
        val passphrase = "7B7602FEF5DEDA10F768818FFACBC60B173DB223B7E66D8B2221EBE2C635EFAD"
        try {
            LcpClient.findOneValidPassphrase(prodLicense.json.toString(), listOf(passphrase)) == passphrase
        } catch (e: Exception) {
            false
        }
    }()

    val stateMachine = StateMachine.create<State, Event> {
        initialState(State.start)
        state<State.start> {
            on<Event.retrievedLicenseData> {
                if (DEBUG) Timber.d("State.validateLicense(it.data, null)")
                transitionTo(State.validateLicense(it.data, null))
            }
        }
        state<State.validateLicense> {
            on<Event.validatedLicense> {
                status?.let { status ->
                    if (DEBUG) Timber.d("State.checkLicenseStatus(it.license, status)")
                    transitionTo(State.checkLicenseStatus(it.license, status, false))
                } ?: run {
                    if (DEBUG) Timber.d("State.fetchStatus(it.license)")
                    transitionTo(State.fetchStatus(it.license))
                }
            }
            on<Event.failed> {
                if (DEBUG) Timber.d("State.failure(it.error)")
                transitionTo(State.failure(it.error))
            }
        }
        state<State.fetchStatus> {
            on<Event.retrievedStatusData> {
                if (DEBUG) Timber.d("State.validateStatus(license, it.data)")
                transitionTo(State.validateStatus(license, it.data))
            }
            on<Event.failed> {
                if (!ignoreInternetErrors && it.error is LcpException && it.error.error is LcpError.Network) {
                    if (DEBUG) Timber.d("State.failure(it.error)")
                    transitionTo(State.failure(it.error))
                } else {
                    if (DEBUG) Timber.d("State.checkLicenseStatus(license, null)")
                    transitionTo(State.checkLicenseStatus(license, null, false))
                }
            }
        }
        state<State.validateStatus> {
            on<Event.validatedStatus> {
                if (license.updated < it.status.licenseUpdated) {
                    if (DEBUG) Timber.d("State.fetchLicense(license, it.status)")
                    transitionTo(State.fetchLicense(license, it.status))
                } else {
                    if (DEBUG) Timber.d("State.checkLicenseStatus(license, it.status)")
                    transitionTo(State.checkLicenseStatus(license, it.status, false))
                }
            }
            on<Event.failed> {
                if (DEBUG) Timber.d("State.checkLicenseStatus(license, null)")
                transitionTo(State.checkLicenseStatus(license, null, false))
            }
        }
        state<State.fetchLicense> {
            on<Event.retrievedLicenseData> {
                if (DEBUG) Timber.d("State.validateLicense(it.data, status)")
                transitionTo(State.validateLicense(it.data, status))
            }
            on<Event.failed> {
                if (DEBUG) Timber.d("State.checkLicenseStatus(license, status)")
                transitionTo(State.checkLicenseStatus(license, status, true))
            }
        }
        state<State.checkLicenseStatus> {
            on<Event.checkedLicenseStatus> {
                it.error?.let { error ->
                    if (DEBUG) {
                        Timber.d(
                            "State.valid(ValidatedDocuments(license, Either.Right(error), status))"
                        )
                    }
                    transitionTo(
                        State.valid(ValidatedDocuments(license, Either.Right(error), status))
                    )
                } ?: run {
                    if (DEBUG) Timber.d("State.requestPassphrase(license, status)")
                    transitionTo(State.retrievePassphrase(license, status))
                }
            }
        }
        state<State.retrievePassphrase> {
            on<Event.retrievedPassphrase> {
                if (DEBUG) Timber.d("State.validateIntegrity(license, status, it.passphrase)")
                transitionTo(State.validateIntegrity(license, status, it.passphrase))
            }
            on<Event.failed> {
                if (DEBUG) Timber.d("State.failure(it.error)")
                transitionTo(State.failure(it.error))
            }
            on<Event.cancelled> {
                if (DEBUG) Timber.d("State.cancelled")
                transitionTo(State.cancelled)
            }
        }
        state<State.validateIntegrity> {
            on<Event.validatedIntegrity> {
                val documents = ValidatedDocuments(license, Either.Left(it.context), status)
                val link = status?.link(StatusDocument.Rel.Register)
                link?.let {
                    if (DEBUG) Timber.d("State.registerDevice(documents, link)")
                    transitionTo(State.registerDevice(documents, link))
                } ?: run {
                    if (DEBUG) Timber.d("State.valid(documents)")
                    transitionTo(State.valid(documents))
                }
            }
            on<Event.failed> {
                if (DEBUG) Timber.d("State.failure(it.error)")
                transitionTo(State.failure(it.error))
            }
        }
        state<State.registerDevice> {
            on<Event.registeredDevice> {
                it.statusData?.let { statusData ->
                    if (DEBUG) Timber.d("State.validateStatus(documents.license, statusData)")
                    transitionTo(State.validateStatus(documents.license, statusData))
                } ?: run {
                    if (DEBUG) Timber.d("State.valid(documents)")
                    transitionTo(State.valid(documents))
                }
            }
            on<Event.failed> {
                if (DEBUG) Timber.d("State.valid(documents)")
                transitionTo(State.valid(documents))
            }
        }
        state<State.valid> {
            on<Event.retrievedStatusData> {
                if (DEBUG) Timber.d("State.validateStatus(documents.license, it.data)")
                transitionTo(State.validateStatus(documents.license, it.data))
            }
        }
        state<State.failure> {
            onEnter {
                if (DEBUG) Timber.d("throw error")
//                throw error
            }
        }
        state<State.cancelled> {
        }
        onTransition { transition ->
            val validTransition = transition as? StateMachine.Transition.Valid
            validTransition?.let {
                state = it.toState
            }
        }
    }

    private fun raise(event: Event) {
        stateMachine.transition(event)
    }

    private fun handle(state: State) {
        try {
            runBlocking {
                when (state) {
                    is State.start -> notifyObservers(documents = null, error = null)
                    is State.validateLicense -> validateLicense(state.data)
                    is State.fetchStatus -> fetchStatus(state.license)
                    is State.validateStatus -> validateStatus(state.data)
                    is State.fetchLicense -> fetchLicense(state.status)
                    is State.checkLicenseStatus -> checkLicenseStatus(
                        state.license,
                        state.status,
                        state.statusDocumentTakesPrecedence
                    )
                    is State.retrievePassphrase -> requestPassphrase(state.license)
                    is State.validateIntegrity -> validateIntegrity(state.license, state.passphrase)
                    is State.registerDevice -> registerDevice(state.documents.license, state.link)
                    is State.valid -> notifyObservers(state.documents, null)
                    is State.failure -> notifyObservers(null, state.error)
                    State.cancelled -> notifyObservers(null, null)
                }
            }
        } catch (error: Exception) {
            if (DEBUG) Timber.e(error)
            raise(Event.failed(error))
        }
    }

    private fun observe(event: Event, observer: Observer) {
        raise(event)
        Companion.observe(this, ObserverPolicy.Once, observer)
    }

    private fun notifyObservers(documents: ValidatedDocuments?, error: Exception?) {
        for (observer in observers) {
//            Timber.d("observers $observers")
            observer.first(documents, error)
        }
//        Timber.d("observers $observers")
        observers = (observers.filter { it.second != ObserverPolicy.Once }).toMutableList()
//        Timber.d("observers $observers")
    }

    private fun validateLicense(data: ByteArray) {
        val license = LicenseDocument(data = data)
        if (!isProduction && license.encryption.profile != "http://readium.org/lcp/basic-profile") {
            throw LcpException(LcpError.LicenseProfileNotSupported)
        }
        onLicenseValidated(license)
        raise(Event.validatedLicense(license))
    }

    private suspend fun fetchStatus(license: LicenseDocument) {
        val url = license.url(
            LicenseDocument.Rel.Status,
            preferredType = MediaType.LCP_STATUS_DOCUMENT
        ).toString()
        // Short timeout to avoid blocking the License, when the LSD is optional.
        val timeout = 5.seconds.takeIf { ignoreInternetErrors }
        val data = network.fetch(
            url,
            timeout = timeout,
            headers = mapOf("Accept" to MediaType.LCP_STATUS_DOCUMENT.toString())
        )
            .getOrElse { throw LcpException(LcpError.Network(it)) }

        raise(Event.retrievedStatusData(data))
    }

    private fun validateStatus(data: ByteArray) {
        val status = StatusDocument(data = data)
        raise(Event.validatedStatus(status))
    }

    private suspend fun fetchLicense(status: StatusDocument) {
        val url = status.url(
            StatusDocument.Rel.License,
            preferredType = MediaType.LCP_LICENSE_DOCUMENT
        ).toString()
        // Short timeout to avoid blocking the License, since it can be updated next time.
        val data = network.fetch(url, timeout = 5.seconds)
            .getOrElse { throw LcpException(LcpError.Network(it)) }

        raise(Event.retrievedLicenseData(data))
    }

    private fun checkLicenseStatus(
        license: LicenseDocument,
        status: StatusDocument?,
        statusDocumentTakesPrecedence: Boolean,
    ) {
        var error: LcpError.LicenseStatus? = null
        val now = Instant.now()
        val start = license.rights.start ?: now
        val end = license.rights.end ?: now
        val isLicenseExpired = (start > now || now > end)
        val isStatusValid = status?.status in listOf(
            null,
            StatusDocument.Status.Active,
            StatusDocument.Status.Ready
        )

        // We only check the Status Document's status if the License itself is expired, to get a proper status error message.
        // But in the case where the Status Document takes precedence (eg. after a failed License update),
        // then we also check the status validity.
        if (isLicenseExpired || statusDocumentTakesPrecedence && !isStatusValid) {
            error = if (status != null) {
                val date = status.statusUpdated
                when (status.status) {
                    StatusDocument.Status.Ready, StatusDocument.Status.Active, StatusDocument.Status.Expired ->
                        if (start > now) {
                            LcpError.LicenseStatus.NotStarted(start)
                        } else {
                            LcpError.LicenseStatus.Expired(end)
                        }
                    StatusDocument.Status.Returned -> LcpError.LicenseStatus.Returned(date)
                    StatusDocument.Status.Revoked -> {
                        val devicesCount = status.events(
                            org.readium.r2.lcp.license.model.components.lsd.Event.EventType.Register
                        ).size
                        LcpError.LicenseStatus.Revoked(date, devicesCount = devicesCount)
                    }
                    StatusDocument.Status.Cancelled -> LcpError.LicenseStatus.Cancelled(date)
                }
            } else {
                if (start > now) {
                    LcpError.LicenseStatus.NotStarted(start)
                } else {
                    LcpError.LicenseStatus.Expired(end)
                }
            }
        }
        raise(Event.checkedLicenseStatus(error))
    }

    private suspend fun requestPassphrase(license: LicenseDocument) {
        if (DEBUG) Timber.d("requestPassphrase")
        val passphrase = passphrases.request(license, authentication, allowUserInteraction)
        if (passphrase == null) {
            raise(Event.cancelled)
        } else {
            raise(Event.retrievedPassphrase(passphrase))
        }
    }

    private suspend fun validateIntegrity(license: LicenseDocument, passphrase: String) {
        if (DEBUG) Timber.d("validateIntegrity")
        val profile = license.encryption.profile
        if (!supportedProfiles.contains(profile)) {
            throw LcpException(LcpError.LicenseProfileNotSupported)
        }
        val context = LcpClient.createContext(license.json.toString(), passphrase, crl.retrieve())
        raise(Event.validatedIntegrity(context))
    }

    private suspend fun registerDevice(license: LicenseDocument, link: Link) {
        if (DEBUG) Timber.d("registerDevice")
        val data = device.registerLicense(license, link)
        raise(Event.registeredDevice(data))
    }

    companion object {
        fun observe(
            licenseValidation: LicenseValidation,
            policy: ObserverPolicy = ObserverPolicy.Always,
            observer: Observer,
        ) {
            var notified = true
            when (licenseValidation.stateMachine.state) {
                is State.valid -> observer(
                    (licenseValidation.stateMachine.state as State.valid).documents,
                    null
                )
                is State.failure -> observer(
                    null,
                    (licenseValidation.stateMachine.state as State.failure).error
                )
                is State.cancelled -> observer(null, null)
                else -> notified = false
            }
            if (notified && policy != ObserverPolicy.Always) {
                return
            }
            observers.add(Pair(observer, policy))
        }
    }
}
