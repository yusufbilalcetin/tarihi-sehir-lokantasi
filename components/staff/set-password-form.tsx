"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Mirrors the server's floor so the form can say so before a round trip. */
const MINIMUM_PASSWORD_LENGTH = 10;

interface SetPasswordErrors {
  password?: string;
  confirmation?: string;
  form?: string;
}

/**
 * The last step of onboarding. The token comes from the one-time setup link and
 * is only ever handed straight back to the server — this component never asks
 * the provider for a session, so no auth cookie exists until the person signs
 * in with the password they just chose.
 */
export function SetPasswordForm({ tokenHash }: { tokenHash: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [errors, setErrors] = useState<SetPasswordErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tokenHash) return;

    const next: SetPasswordErrors = {};
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      next.password = `Şifre en az ${MINIMUM_PASSWORD_LENGTH} karakter olmalıdır.`;
    }
    if (confirmation !== password) {
      next.confirmation = "Şifreler eşleşmiyor.";
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const response = await fetch("/api/staff/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenHash, password }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { redirectTo?: string; error?: string }
        | null;

      if (!response.ok || !payload?.redirectTo) {
        setErrors({ form: payload?.error ?? "Şifre belirlenemedi. Lütfen tekrar deneyin." });
        setSubmitting(false);
        return;
      }

      // Cleared from state the moment it is no longer needed.
      setPassword("");
      setConfirmation("");
      setDone(true);
      router.replace(payload.redirectTo);
    } catch {
      setErrors({ form: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin." });
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-olive px-4 py-8 sm:px-6">
      <div className="absolute inset-x-0 top-0 h-px bg-copper/45" aria-hidden="true" />
      <section className="w-full max-w-md" aria-labelledby="staff-set-password-title">
        <div className="mb-7 flex justify-center">
          <BrandMark priority className="w-[min(78vw,340px)] drop-shadow-[0_10px_24px_rgb(0_0_0/0.2)]" />
        </div>

        <div className="rounded-xl border border-copper/25 bg-card p-5 shadow-[0_28px_80px_rgb(24_27_22/0.28)] sm:p-7">
          <div className="mb-6 flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-burgundy/[0.08] text-burgundy">
              <ShieldCheck className="size-5" strokeWidth={1.8} />
            </div>
            <div>
              <h1
                id="staff-set-password-title"
                className="font-heading text-2xl font-semibold tracking-tight"
              >
                Şifrenizi belirleyin
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Bu bağlantı tek kullanımlıktır. Şifrenizi belirledikten sonra normal giriş
                ekranından oturum açacaksınız.
              </p>
            </div>
          </div>

          {tokenHash === null ? (
            <div
              className="rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm font-medium text-destructive"
              role="alert"
            >
              Bu bağlantı geçersiz. Yöneticinizden yeni bir kurulum bağlantısı isteyin.
            </div>
          ) : done ? (
            <div
              className="rounded-lg border border-copper/30 bg-copper/[0.08] px-3 py-2.5 text-sm font-medium"
              role="status"
            >
              Şifreniz belirlendi. Giriş ekranına yönlendiriliyorsunuz.
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              <div className="space-y-2">
                <label htmlFor="new-password" className="text-sm font-semibold">
                  Yeni şifre
                </label>
                <div className="relative">
                  <KeyRound
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="new-password"
                    name="new-password"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setErrors((current) => ({ ...current, password: undefined, form: undefined }));
                    }}
                    aria-invalid={Boolean(errors.password || errors.form)}
                    aria-describedby={errors.password ? "new-password-error" : "new-password-hint"}
                    className="h-12 bg-background px-10 text-base"
                    placeholder="En az 10 karakter"
                  />
                  <button
                    type="button"
                    onClick={() => setVisible((shown) => !shown)}
                    className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={visible ? "Şifreyi gizle" : "Şifreyi göster"}
                  >
                    {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {errors.password ? (
                  <p id="new-password-error" className="text-sm font-medium text-destructive">
                    {errors.password}
                  </p>
                ) : (
                  <p id="new-password-hint" className="text-xs text-muted-foreground">
                    Şifrenizi kimseyle paylaşmayın.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="confirm-password" className="text-sm font-semibold">
                  Yeni şifre (tekrar)
                </label>
                <Input
                  id="confirm-password"
                  name="confirm-password"
                  type={visible ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => {
                    setConfirmation(event.target.value);
                    setErrors((current) => ({
                      ...current,
                      confirmation: undefined,
                      form: undefined,
                    }));
                  }}
                  aria-invalid={Boolean(errors.confirmation || errors.form)}
                  aria-describedby={errors.confirmation ? "confirm-password-error" : undefined}
                  className="h-12 bg-background text-base"
                  placeholder="Şifrenizi tekrar girin"
                />
                {errors.confirmation ? (
                  <p id="confirm-password-error" className="text-sm font-medium text-destructive">
                    {errors.confirmation}
                  </p>
                ) : null}
              </div>

              {errors.form ? (
                <div
                  className="rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm font-medium text-destructive"
                  role="alert"
                >
                  {errors.form}
                </div>
              ) : null}

              <Button
                type="submit"
                size="lg"
                className="min-h-12 w-full text-base"
                disabled={submitting}
              >
                {submitting ? "Kaydediliyor" : "Şifreyi Belirle"}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-xs font-medium text-cream/55">
          Yalnızca yetkili restoran personeli içindir.
        </p>
      </section>
    </main>
  );
}
