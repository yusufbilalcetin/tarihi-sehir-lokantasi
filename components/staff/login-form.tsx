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

const DEMO_CODE = "1042";
const DEMO_PIN = "1234";

export function LoginForm() {
  const router = useRouter();
  const [values, setValues] = useState<LoginValues>({ code: "", pin: "" });
  const [errors, setErrors] = useState<LoginErrors>({});
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: LoginErrors = {};
    if (!values.code.trim()) nextErrors.code = "Personel kodunuzu girin.";
    if (!values.pin.trim()) nextErrors.pin = "PIN kodunuzu girin.";

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    if (values.code !== DEMO_CODE || values.pin !== DEMO_PIN) {
      setErrors({ form: "Personel kodu veya PIN hatalı. Demo bilgilerini kontrol edin." });
      return;
    }

    setErrors({});
    setSubmitting(true);
    router.push("/staff/dashboard");
  }

  function setField(field: keyof LoginValues, value: string) {
    const onlyNumbers = value.replace(/\D/g, "");
    setValues((current) => ({ ...current, [field]: onlyNumbers }));
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
                Personel Kodu
              </label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
                <Input
                  id="staff-code"
                  name="staff-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="username"
                  maxLength={4}
                  value={values.code}
                  onChange={(event) => setField("code", event.target.value)}
                  aria-invalid={Boolean(errors.code || errors.form)}
                  aria-describedby={errors.code ? "staff-code-error" : undefined}
                  className="h-12 bg-background pl-10 text-base tracking-[0.12em]"
                  placeholder="4 haneli kod"
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
                PIN
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
                <Input
                  id="staff-pin"
                  name="staff-pin"
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  autoComplete="current-password"
                  maxLength={4}
                  value={values.pin}
                  onChange={(event) => setField("pin", event.target.value)}
                  aria-invalid={Boolean(errors.pin || errors.form)}
                  aria-describedby={errors.pin ? "staff-pin-error" : undefined}
                  className="h-12 bg-background px-10 text-base tracking-[0.2em]"
                  placeholder="4 haneli PIN"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((visible) => !visible)}
                  className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showPin ? "PIN kodunu gizle" : "PIN kodunu göster"}
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

          <div className="mt-5 rounded-lg border border-border bg-muted/55 px-4 py-3 text-sm">
            <p className="font-semibold text-foreground">Demo bilgileri</p>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
              <span>Kod: <strong className="font-mono text-foreground">1042</strong></span>
              <span>PIN: <strong className="font-mono text-foreground">1234</strong></span>
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-xs font-medium text-cream/55">
          Yalnızca yetkili restoran personeli içindir.
        </p>
      </section>
    </main>
  );
}
