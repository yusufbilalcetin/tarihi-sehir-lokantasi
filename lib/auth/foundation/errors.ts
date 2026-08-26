import { DomainError } from "@/lib/api/domain-error";

export function authenticationRequiredError(): DomainError {
  return new DomainError("AUTHENTICATION_REQUIRED", "Personel oturumu gereklidir.", {
    httpStatus: 401,
  });
}
export function accountInactiveError(): DomainError {
  return new DomainError("ACCOUNT_INACTIVE", "Personel hesabı aktif değildir.", {
    httpStatus: 403,
  });
}

export function roleForbiddenError(): DomainError {
  return new DomainError("FORBIDDEN", "Bu işlem için yetkiniz bulunmuyor.", {
    httpStatus: 403,
  });
}

export function restaurantScopeViolationError(): DomainError {
  return new DomainError(
    "RESTAURANT_SCOPE_VIOLATION",
    "Bu restoran kaynağına erişim yetkiniz bulunmuyor.",
    { httpStatus: 403 },
  );
}

export function invalidStaffIdentityError(cause?: unknown): DomainError {
  return new DomainError("INTERNAL_ERROR", "Personel kimliği doğrulanamadı.", {
    httpStatus: 500,
    expose: false,
    cause,
  });
}
