/**
 * Русский словарь строк интерфейса. Плоский объект-словарь — задел под
 * казахский без i18n-фреймворка (по ТЗ). Доступ: t.section.key.
 */
export const ru = {
  app: {
    name: "Arlan Ops",
    tagline: "система управления и учёта производства West Arlan Group",
    /** Владелец внедрения — «ТОО» в казахской версии станет «ЖШС». */
    owner: "ТОО «West Arlan Group»",
    copyright: "ArlanOps by Akdaulet Almas ©",
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
  /**
   * Ошибки, которые повторяются на нескольких экранах. Одна формулировка на
   * один случай: раньше та же ситуация звучала то «из списка», то «из сетки»,
   * а запасным текстом было просто «Ошибка» — она не говорит, что делать.
   */
  errors: {
    generic: "Не удалось выполнить операцию. Повторите попытку.",
    requiredFields: "Заполните выделенные поля",
    qrUnknown: "QR не распознан. Выберите машину из списка.",
    cameraUnavailable: "Камера недоступна. Выберите машину из списка.",
  },
  empty: {
    notFound: "Ничего не найдено",
    resetFilters: "Сбросить фильтры",
  },
} as const;

export type Dictionary = typeof ru;
