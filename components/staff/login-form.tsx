"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, LockKeyhole, UserRound } from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LoginValues {
  code: string;
  pin: string;
}

interface LoginErrors {
  code?: string;
  pin?: string;
  form?: string;
}

export function LoginForm() {
  const router = useRouter();
  const [values, setValues] = useState<LoginValues>({ code: "", pin: "" });
  const [errors, setErrors] = useState<LoginErrors>({});
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: LoginErrors = {};
    if (!values.code.trim()) nextErrors.code = "E-posta veya personel kodunuzu girin.";
    if (!values.pin.trim()) nextErrors.pin = "Şifre veya PIN kodunuzu girin.";

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);

    try {
      // Credentials are only ever checked on the server; this component never
      // sees them and the session cookie it returns is HttpOnly.
      const response = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = (await response.json().catch(() => null)) as
        | { redirectTo?: string; error?: string }
        | null;

      if (!response.ok || !payload?.redirectTo) {
        setErrors({ form: payload?.error ?? "Giriş yapılamadı. Lütfen tekrar deneyin." });
        setSubmitting(false);
        return;
      }

      router.replace(payload.redirectTo);
      router.refresh();
    } catch {
      setErrors({ form: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin." });
      setSubmitting(false);
    }
  }

  function setField(field: keyof LoginValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-olive px-4 py-8 sm:px-6">
      <div className="absolute inset-x-0 top-0 h-px bg-copper/45" aria-hidden="true" />
      <section className="w-full max-w-md" aria-labelledby="staff-login-title">
        <div className="mb-7 flex justify-center">
          <BrandMark priority className="w-[min(78vw,340px)] drop-shadow-[0_10px_24px_rgb(0_0_0/0.2)]" />
        </div>

        <div className="rounded-xl border border-copper/25 bg-card p-5 shadow-[0_28px_80px_rgb(24_27_22/0.28)] sm:p-7">
          <div className="mb-6 flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-burgundy/[0.08] text-burgundy">
              <LockKeyhole className="size-5" strokeWidth={1.8} />
            </div>
            <div>
              <h1 id="staff-login-title" className="font-heading text-2xl font-semibold tracking-tight">
                Personel girişi
              </h1>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Vardiyanıza devam etmek için bilgilerinizi girin.
              </p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <div className="grid gap-2">
              <label htmlFor="staff-code" className="text-sm font-semibold text-foreground">
                E-posta / Personel Kodu
              </label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
                <Input
                  id="staff-code"
                  name="staff-code"
                  type="text"
                  inputMode="text"
                  autoComplete="username"
                  maxLength={320}
                  value={values.code}
                  onChange={(event) => setField("code", event.target.value)}
                  aria-invalid={Boolean(errors.code || errors.form)}
                  aria-describedby={errors.code ? "staff-code-error" : undefined}
                  className="h-12 bg-background pl-10 text-base"
                  placeholder="ornek@lokanta.com veya kod"
                />
              </div>
              {errors.code ? (
                <p id="staff-code-error" className="text-sm font-medium text-destructive">
                  {errors.code}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <label htmlFor="staff-pin" className="text-sm font-semibold text-foreground">
                Şifre / PIN
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
                <Input
                  id="staff-pin"
                  name="staff-pin"
                  type={showPin ? "text" : "password"}
                  autoComplete="current-password"
                  maxLength={1024}
                  value={values.pin}
                  onChange={(event) => setField("pin", event.target.value)}
                  aria-invalid={Boolean(errors.pin || errors.form)}
                  aria-describedby={errors.pin ? "staff-pin-error" : undefined}
                  className="h-12 bg-background px-10 text-base"
                  placeholder="Şifreniz veya PIN kodunuz"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((visible) => !visible)}
                  className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showPin ? "Şifreyi gizle" : "Şifreyi göster"}
                >
                  {showPin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {errors.pin ? (
                <p id="staff-pin-error" className="text-sm font-medium text-destructive">
                  {errors.pin}
                </p>
              ) : null}
            </div>

            {errors.form ? (
              <div className="rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm font-medium text-destructive" role="alert">
                {errors.form}
              </div>
            ) : null}

            <Button type="submit" size="lg" className="min-h-12 w-full text-base" disabled={submitting}>
              {submitting ? "Giriş yapılıyor" : "Giriş Yap"}
            </Button>
          </form>

        </div>

        <p className="mt-5 text-center text-xs font-medium text-cream/55">
          Yalnızca yetkili restoran personeli içindir.
        </p>
      </section>
    </main>
  );
}
