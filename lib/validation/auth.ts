import { z } from "zod";

const email = z
  .string()
  .trim()
  .min(1, "Введите email")
  .toLowerCase()
  .pipe(z.email("Введите корректный email"));

// Минимальная длина пароля синхронизирована с minimum_password_length в supabase/config.toml.
const password = z.string().min(6, "Пароль должен содержать не менее 6 символов");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Введите пароль"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, "Введите имя")
      .max(120, "Имя слишком длинное"),
    email,
    password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Пароли не совпадают",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Пароли не совпадают",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const profileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Введите имя")
    .max(120, "Имя слишком длинное"),
});

export type ProfileInput = z.infer<typeof profileSchema>;
