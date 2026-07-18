/**
 * Русский словарь строк интерфейса. Плоский объект-словарь — задел под
 * казахский без i18n-фреймворка (по ТЗ). Доступ: t.section.key.
 */
export const ru = {
  app: {
    name: "Arlan Ops",
    tagline: "система управления и учёта производства West Arlan Group",
  },
  common: {
    signIn: "Войти",
    signOut: "Выйти",
    loading: "Загрузка…",
    save: "Сохранить",
    cancel: "Отмена",
    settings: "Настройки",
  },
  auth: {
    loginTitle: "Вход в систему",
    loginSubtitle: "Учёт техники и ГСМ карьера",
    email: "Email",
    password: "Пароль",
    signingIn: "Входим…",
    invalidCredentials: "Неверный email или пароль",
    unknownError: "Не удалось войти. Попробуйте ещё раз.",
    noAccessTitle: "Доступ не настроен",
    noAccessText:
      "Ваша учётная запись не имеет ролей. Обратитесь к администратору.",
  },
  theme: {
    auto: "Авто",
    light: "Светлая",
    dark: "Тёмная",
    label: "Тема",
  },
} as const;

export type Dictionary = typeof ru;
