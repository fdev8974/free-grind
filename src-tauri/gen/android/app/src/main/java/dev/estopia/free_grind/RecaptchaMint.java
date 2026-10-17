package dev.estopia.free_grind;

import android.app.Application;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.android.recaptcha.Recaptcha;
import com.google.android.recaptcha.RecaptchaAction;
import com.google.android.recaptcha.RecaptchaException;

/**
 * Mints reCAPTCHA Enterprise tokens for Grindr's site key (ported from the
 * former Free Grind reCAPTCHA helper app).
 *
 * Java on purpose: the SDK is built with Kotlin 2.3 metadata, which this
 * project's Kotlin 1.9 compiler refuses to read. Kotlin code only touches
 * this class, never the SDK.
 *
 * Only call it from the ":recaptcha" process (RecaptchaMintActivity), where
 * FreeGrindApplication reports Grindr's package name to the SDK.
 */
public final class RecaptchaMint {
    private static final String SITE_KEY = "6LeGNmIqAAAAAIi9lNGTgQbFdzohq1cRfQCZW7eB";
    private static final long TIMEOUT_MILLIS = 20_000L;

    private RecaptchaMint() {}

    public static Task<String> mint(Application application, String action) {
        try {
            return Recaptcha.fetchTaskClient(application, SITE_KEY)
                .onSuccessTask(client -> client.executeTask(RecaptchaAction.custom(action), TIMEOUT_MILLIS));
        } catch (RuntimeException e) {
            return Tasks.forException(e);
        }
    }

    /** The SDK's error code when there is one, else the exception's class name. */
    public static String failureDetail(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof RecaptchaException) {
                return ((RecaptchaException) cause).getErrorCode().name();
            }
        }
        return error.getClass().getSimpleName();
    }
}
