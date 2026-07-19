'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';

const loginSchema = z.object({
  identifier: z.string().min(1, 'Username or email is required'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const { login } = useAuth();
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.identifier, values.password);
      router.push('/dashboard');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Unable to sign in. Please try again.');
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="identifier">Username or email</Label>
        <Input id="identifier" autoComplete="username" {...register('identifier')} />
        {errors.identifier ? <p className="text-sm text-error">{errors.identifier.message}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
        {errors.password ? <p className="text-sm text-error">{errors.password.message}</p> : null}
      </div>
      {formError ? (
        <p role="alert" className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={isSubmitting} className="mt-2">
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
