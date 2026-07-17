export const ANOMALY_LABELS: Record<string, string> = {
  fuel_no_work: "Топливо без работы",
  work_no_fuel: "Работа без топлива",
  over_norm: "Расход выше норматива",
  short_trip_interval: "Подозрительный интервал рейса",
  driver_double_shift: "Один водитель день+ночь",
  hours_over_11: "Более 11 часов за сутки",
  unapproved_unit: "Недопущенная техника/водитель",
  tanker_gap: "Расхождение по бензовозу",
  unmatched_txn: "Транзакция без записи",
  continuous_driving: "Вождение без перерыва",
};

export const STATUS_LABELS: Record<string, string> = {
  new: "Новый",
  reviewed: "Просмотрен",
  confirmed: "Подтверждён",
  dismissed: "Снят",
};

export const SEVERITY_LABELS: Record<string, string> = {
  low: "низкая",
  medium: "средняя",
  high: "высокая",
};

/** Типы, которые можно конвертировать в штраф (есть привязка к договору через машину). */
export const PENALTY_TYPES = new Set(["over_norm"]);
