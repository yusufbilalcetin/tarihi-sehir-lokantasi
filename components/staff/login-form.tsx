"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, LockKeyhole, UserRound } from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LoginValues {
  username: string;
  password: string;
}

interface LoginErrors {
  username?: string;
  password?: string;
  form?: string;
}

export function LoginForm() {
  const router = useRouter();
  const [values, setValues] = useState<LoginValues>({ username: "", password: "" });
  const [errors, setErrors] = useState<LoginErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: LoginErrors = {};
    if (!values.username.trim()) nextErrors.username = "Kullanıcı adınızı girin.";
    if (!values.password) nextErrors.password = "Şifrenizi girin.";

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
        // The server decides what the username stands for; nothing about the
        // identity behind it is known here.
        body: JSON.stringify({
          identifier: values.username.trim(),
          password: values.password,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { redirectTo?: string; error?: string }
        | null;

      if (!response.ok || !payload?.redirectTo) {
        // One message for every rejection: a wrong password and an unknown
        // user must not be distinguishable from out here.
        setErrors({
          form:
            response.status === 401 || response.status === 400
              ? "Kullanıcı adı veya şifre hatalı."
              : payload?.error ?? "Giriş yapılamadı. Lütfen tekrar deneyin.",
        });
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
                Kullanıcı adınız ve şifrenizle giriş yapın.
              </p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <div className="grid gap-2">
              <label htmlFor="staff-username" className="text-sm font-semibold text-foreground">
                Kullanıcı Adı
              </label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
                <Input
                  id="staff-username"
                  name="username"
                  type="text"
                  inputMode="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={320}
                  value={values.username}
                  onChange={(event) => setField("username", event.target.value)}
                  aria-invalid={Boolean(errors.username || errors.form)}
                  aria-describedby={errors.username ? "staff-username-error" : undefined}
                  className="h-12 bg-background pl-10 text-base"
                />
              </div>
              {errors.username ? (
                <p id="staff-username-error" className="text-sm font-medium text-destructive">
                  {errors.username}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <label htmlFor="staff-password" className="text-sm font-semibold text-foreground">
                Şifre
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
                <Input
                  id="staff-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  maxLength={1024}
                  value={values.password}
                  onChange={(event) => setField("password", event.target.value)}
                  aria-invalid={Boolean(errors.password || errors.form)}
                  aria-describedby={errors.password ? "staff-password-error" : undefined}
                  className="h-12 bg-background px-10 text-base"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {errors.password ? (
                <p id="staff-password-error" className="text-sm font-medium text-destructive">
                  {errors.password}
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
