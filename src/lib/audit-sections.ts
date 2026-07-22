/** Разделы журнала изменений: раздел → таблицы. Общий для сервера и клиента. */
export const AUDIT_SECTIONS: Record<string, { label: string; tables: string[] }> = {
  fuel: { label: "Топливо", tables: ["fuel_issues", "fuel_cards", "tankers", "tanker_refills", "tanker_measurements", "contract_fuel_prices"] },
  trips: { label: "Рейсы", tables: ["trip_records", "trip_lineups", "trip_lineup_vehicles", "routes"] },
  shifts: { label: "Смены", tables: ["shift_records", "shift_journals", "work_types"] },
  registry: { label: "Справочники", tables: ["vehicles", "drivers", "contractors"] },
  contracts: { label: "Договоры", tables: ["contracts", "price_list", "penalties"] },
  anomalies: { label: "Аномалии", tables: ["anomalies", "org_settings"] },
  documents: { label: "Документы", tables: ["generated_documents", "document_templates"] },
  users: { label: "Пользователи", tables: ["profiles"] },
};
