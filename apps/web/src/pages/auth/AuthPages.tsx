import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Alert, Button, IconShield, Input, Logo } from '../../design-system';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-2">
      <section className="hidden lg:flex flex-col justify-between bg-navy-900 text-white p-12 ebk-grid-bg relative overflow-hidden">
        <div className="absolute -left-24 bottom-0 size-96 rounded-full bg-emerald-600/20 blur-3xl" aria-hidden />
        <Logo inverted showTagline />
        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold tracking-tight leading-tight">Your Money.<br /><span className="text-mint-300">Your World.</span></h2>
          <p className="mt-4 text-mint-300/90 text-lg">Send money from the UK to family in Zambia — straight to MTN MoMo and Airtel Money, with the fee and rate shown upfront.</p>
          <ul className="mt-8 space-y-3 text-[15px]">
            {['Transparent fees, no hidden margins on the quote', 'Rate locked before you pay', 'Track every transfer to delivery'].map((t) => (
              <li key={t} className="flex items-center gap-3"><span className="grid size-6 place-items-center rounded-full bg-emerald-600"><IconShield size={14} /></span>{t}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-mint-300/70">EBK is not a bank. Payments are collected and paid out by authorised financial partners.</p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8"><Logo showTagline /></div>
          <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-muted-strong">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  );
}

const loginSchema = z.object({ email: z.string().trim().email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') });

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await login(v.email, v.password);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'We couldn’t sign you in. Please try again.');
    }
  });

  return (
    <AuthLayout title="Welcome back" subtitle={<>New to EBK? <Link to="/register" className="font-semibold text-emerald-700 hover:underline">Create an account</Link></>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Input label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        <div className="text-right"><Link to="/help" className="text-sm font-semibold text-emerald-700 hover:underline">Forgot password?</Link></div>
        <Button type="submit" size="lg" block loading={isSubmitting}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}

const registerSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(80),
  lastName: z.string().trim().min(1, 'Enter your last name').max(80),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(12, 'Use at least 12 characters').max(128),
  terms: z.literal(true, { errorMap: () => ({ message: 'Please accept the terms to continue' }) }),
});

export function RegisterPage() {
  const { register: signUp } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, setError: setFieldError, formState: { errors, isSubmitting } } = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async ({ terms: _t, ...v }) => {
    setError(null);
    try {
      await signUp({ ...v, countryOfResidence: 'GB' });
      navigate('/', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.body.fields?.length) e.body.fields.forEach((f) => setFieldError(f.path as 'email', { message: f.message }));
      else setError(e instanceof Error ? e.message : 'Could not create your account');
    }
  });

  return (
    <AuthLayout title="Create your account" subtitle={<>Already with EBK? <Link to="/login" className="font-semibold text-emerald-700 hover:underline">Sign in</Link></>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Input label="First name" autoComplete="given-name" error={errors.firstName?.message} {...register('firstName')} />
          <Input label="Last name" autoComplete="family-name" error={errors.lastName?.message} {...register('lastName')} />
        </div>
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Input label="Password" type="password" autoComplete="new-password" hint="At least 12 characters. A short phrase works well." error={errors.password?.message} {...register('password')} />
        <p className="text-sm text-muted-strong">EBK Send is currently available to UK residents sending to Zambia.</p>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-emerald-600" {...register('terms')} />
          <span>I agree to the EBK terms and privacy notice.</span>
        </label>
        {errors.terms && <p role="alert" className="text-sm text-danger-700">{errors.terms.message}</p>}
        <Button type="submit" size="lg" block loading={isSubmitting}>Create account</Button>
      </form>
    </AuthLayout>
  );
}
