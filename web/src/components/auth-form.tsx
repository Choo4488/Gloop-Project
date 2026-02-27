"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 chars"),
});

type AuthFormValues = z.infer<typeof schema>;

type AuthFormProps = {
  title: string;
  submitLabel: string;
  onSubmit: (data: AuthFormValues) => Promise<void>;
  loading: boolean;
  errorMessage: string | null;
};

export function AuthForm({ title, submitLabel, onSubmit, loading, errorMessage }: AuthFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AuthFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  return (
    <div className="w-full max-w-md rounded-2xl bg-white/90 p-8 shadow-xl">
      <h1 className="mb-4 text-2xl font-bold text-slate-900">{title}</h1>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            {...register("email")}
            type="email"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500"
          />
          {errors.email?.message ? <p className="mt-1 text-sm text-red-500">{errors.email.message}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
          <input
            {...register("password")}
            type="password"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500"
          />
          {errors.password?.message ? <p className="mt-1 text-sm text-red-500">{errors.password.message}</p> : null}
        </div>
        {errorMessage ? <p className="text-sm text-red-500">{errorMessage}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {loading ? "Processing..." : submitLabel}
        </button>
      </form>
    </div>
  );
}
