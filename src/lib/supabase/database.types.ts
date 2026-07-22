export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      anomalies: {
        Row: {
          created_at: string
          dedup_key: string | null
          detected_at: string
          entity_refs: Json | null
          id: string
          org_id: string
          resolution_note: string | null
          reviewed_by: string | null
          severity: string
          status: string
          type: string
        }
        Insert: {
          created_at?: string
          dedup_key?: string | null
          detected_at?: string
          entity_refs?: Json | null
          id?: string
          org_id?: string
          resolution_note?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          type: string
        }
        Update: {
          created_at?: string
          dedup_key?: string | null
          detected_at?: string
          entity_refs?: Json | null
          id?: string
          org_id?: string
          resolution_note?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "anomalies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          at: string
          changed_cols: string[] | null
          id: number
          new_row: Json | null
          old_row: Json | null
          org_id: string | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          at?: string
          changed_cols?: string[] | null
          new_row?: Json | null
          old_row?: Json | null
          org_id?: string | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          at?: string
          changed_cols?: string[] | null
          new_row?: Json | null
          old_row?: Json | null
          org_id?: string | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      card_transactions: {
        Row: {
          amount: number | null
          created_at: string
          fuel_card_id: string
          id: string
          import_batch_id: string | null
          liters: number
          match_status: string
          org_id: string
          station: string | null
          transaction_at: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          fuel_card_id: string
          id?: string
          import_batch_id?: string | null
          liters: number
          match_status?: string
          org_id?: string
          station?: string | null
          transaction_at: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          fuel_card_id?: string
          id?: string
          import_batch_id?: string | null
          liters?: number
          match_status?: string
          org_id?: string
          station?: string | null
          transaction_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_transactions_fuel_card_id_fkey"
            columns: ["fuel_card_id"]
            isOneToOne: false
            referencedRelation: "fuel_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_fuel_prices: {
        Row: {
          contract_id: string
          created_at: string
          doc_type: string | null
          id: string
          note: string | null
          org_id: string
          price_per_liter: number
          valid_from: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          doc_type?: string | null
          id?: string
          note?: string | null
          org_id?: string
          price_per_liter: number
          valid_from: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          doc_type?: string | null
          id?: string
          note?: string | null
          org_id?: string
          price_per_liter?: number
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_fuel_prices_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_fuel_prices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contractors: {
        Row: {
          bank_name: string | null
          bik: string | null
          bin: string | null
          contact_phone: string | null
          counterparty_type: string
          created_at: string
          head_name: string | null
          id: string
          iik: string | null
          is_active: boolean
          legal_address: string | null
          name: string
          org_id: string
          vat_payer: boolean
        }
        Insert: {
          bank_name?: string | null
          bik?: string | null
          bin?: string | null
          contact_phone?: string | null
          counterparty_type?: string
          created_at?: string
          head_name?: string | null
          id?: string
          iik?: string | null
          is_active?: boolean
          legal_address?: string | null
          name: string
          org_id?: string
          vat_payer?: boolean
        }
        Update: {
          bank_name?: string | null
          bik?: string | null
          bin?: string | null
          contact_phone?: string | null
          counterparty_type?: string
          created_at?: string
          head_name?: string | null
          id?: string
          iik?: string | null
          is_active?: boolean
          legal_address?: string | null
          name?: string
          org_id?: string
          vat_payer?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "contractors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          billing_period: string
          contract_type: string
          contractor_id: string
          created_at: string
          id: string
          is_active: boolean
          number: string
          org_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          billing_period?: string
          contract_type: string
          contractor_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          number: string
          org_id?: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          billing_period?: string
          contract_type?: string
          contractor_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          number?: string
          org_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          contract_type: string | null
          created_at: string
          created_by: string
          doc_type: string
          file_url: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          updated_at: string
          version: number
        }
        Insert: {
          contract_type?: string | null
          created_at?: string
          created_by?: string
          doc_type: string
          file_url: string
          id?: string
          is_active?: boolean
          name: string
          org_id?: string
          updated_at?: string
          version?: number
        }
        Update: {
          contract_type?: string | null
          created_at?: string
          created_by?: string
          doc_type?: string
          file_url?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      downtime_records: {
        Row: {
          created_at: string
          created_by: string
          downtime_date: string
          fault_side: string
          hours: number | null
          id: string
          notified_at: string | null
          org_id: string
          reason: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          downtime_date: string
          fault_side: string
          hours?: number | null
          id?: string
          notified_at?: string | null
          org_id?: string
          reason: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          downtime_date?: string
          fault_side?: string
          hours?: number | null
          id?: string
          notified_at?: string | null
          org_id?: string
          reason?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "downtime_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_records_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          approved_from: string | null
          approved_to: string | null
          contract_id: string | null
          contractor_id: string | null
          created_at: string
          full_name: string
          id: string
          iin: string | null
          is_active: boolean
          org_id: string
          phone: string | null
        }
        Insert: {
          approved_from?: string | null
          approved_to?: string | null
          contract_id?: string | null
          contractor_id?: string | null
          created_at?: string
          full_name: string
          id?: string
          iin?: string | null
          is_active?: boolean
          org_id?: string
          phone?: string | null
        }
        Update: {
          approved_from?: string | null
          approved_to?: string | null
          contract_id?: string | null
          contractor_id?: string | null
          created_at?: string
          full_name?: string
          id?: string
          iin?: string | null
          is_active?: boolean
          org_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_settings: {
        Row: {
          availability_coeff: number
          baseline_date: string
          baseline_volume_m3: number
          org_id: string
          target_date: string | null
          target_volume_m3: number
          trips_per_truck_shift: number
          trucks_per_excavator: number
          updated_at: string
        }
        Insert: {
          availability_coeff?: number
          baseline_date?: string
          baseline_volume_m3?: number
          org_id?: string
          target_date?: string | null
          target_volume_m3?: number
          trips_per_truck_shift?: number
          trucks_per_excavator?: number
          updated_at?: string
        }
        Update: {
          availability_coeff?: number
          baseline_date?: string
          baseline_volume_m3?: number
          org_id?: string
          target_date?: string | null
          target_volume_m3?: number
          trips_per_truck_shift?: number
          trucks_per_excavator?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_cards: {
        Row: {
          card_number: string
          created_at: string
          id: string
          is_active: boolean
          operator: string | null
          org_id: string
        }
        Insert: {
          card_number: string
          created_at?: string
          id?: string
          is_active?: boolean
          operator?: string | null
          org_id?: string
        }
        Update: {
          card_number?: string
          created_at?: string
          id?: string
          is_active?: boolean
          operator?: string | null
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_cards_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_issues: {
        Row: {
          created_at: string
          driver_id: string
          driver_signature_url: string
          fuel_card_id: string | null
          geo_lat: number | null
          geo_lng: number | null
          id: string
          issued_by: string
          liters: number
          matched_transaction_id: string | null
          odometer: number | null
          org_id: string
          receipt_photo_url: string | null
          source_type: string
          tanker_id: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          driver_signature_url: string
          fuel_card_id?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          issued_by?: string
          liters: number
          matched_transaction_id?: string | null
          odometer?: number | null
          org_id?: string
          receipt_photo_url?: string | null
          source_type: string
          tanker_id?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          driver_signature_url?: string
          fuel_card_id?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          issued_by?: string
          liters?: number
          matched_transaction_id?: string | null
          odometer?: number | null
          org_id?: string
          receipt_photo_url?: string | null
          source_type?: string
          tanker_id?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_issues_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_issues_fuel_card_id_fkey"
            columns: ["fuel_card_id"]
            isOneToOne: false
            referencedRelation: "fuel_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_issues_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "card_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_issues_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_issues_tanker_id_fkey"
            columns: ["tanker_id"]
            isOneToOne: false
            referencedRelation: "tanker_balances"
            referencedColumns: ["tanker_id"]
          },
          {
            foreignKeyName: "fuel_issues_tanker_id_fkey"
            columns: ["tanker_id"]
            isOneToOne: false
            referencedRelation: "tankers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_issues_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          contract_id: string
          created_at: string
          created_by: string
          doc_type: string
          file_url: string
          id: string
          number: string
          org_id: string
          period_from: string | null
          period_to: string | null
          source_refs: Json | null
        }
        Insert: {
          contract_id: string
          created_at?: string
          created_by?: string
          doc_type: string
          file_url: string
          id?: string
          number: string
          org_id?: string
          period_from?: string | null
          period_to?: string | null
          source_refs?: Json | null
        }
        Update: {
          contract_id?: string
          created_at?: string
          created_by?: string
          doc_type?: string
          file_url?: string
          id?: string
          number?: string
          org_id?: string
          period_from?: string | null
          period_to?: string | null
          source_refs?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          no_fuel_days_hours: number
          no_fuel_days_trips: number
          no_fuel_days_trips_single: number
          org_id: string
          tanker_gap_liters: number
          updated_at: string
        }
        Insert: {
          no_fuel_days_hours?: number
          no_fuel_days_trips?: number
          no_fuel_days_trips_single?: number
          org_id?: string
          tanker_gap_liters?: number
          updated_at?: string
        }
        Update: {
          no_fuel_days_hours?: number
          no_fuel_days_trips?: number
          no_fuel_days_trips_single?: number
          org_id?: string
          tanker_gap_liters?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      penalties: {
        Row: {
          amount: number
          contract_id: string
          created_at: string
          created_by: string
          id: string
          org_id: string
          penalty_date: string
          reason: string
          settled_in_period: string | null
        }
        Insert: {
          amount: number
          contract_id: string
          created_at?: string
          created_by?: string
          id?: string
          org_id?: string
          penalty_date: string
          reason: string
          settled_in_period?: string | null
        }
        Update: {
          amount?: number
          contract_id?: string
          created_at?: string
          created_by?: string
          id?: string
          org_id?: string
          penalty_date?: string
          reason?: string
          settled_in_period?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "penalties_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      price_list: {
        Row: {
          contract_id: string
          created_at: string
          doc_type: string | null
          id: string
          note: string | null
          org_id: string
          price: number
          unit: string
          valid_from: string
          vehicle_id: string | null
          vehicle_type: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          doc_type?: string | null
          id?: string
          note?: string | null
          org_id?: string
          price: number
          unit: string
          valid_from: string
          vehicle_id?: string | null
          vehicle_type: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          doc_type?: string | null
          id?: string
          note?: string | null
          org_id?: string
          price?: number
          unit?: string
          valid_from?: string
          vehicle_id?: string | null
          vehicle_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_list_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      production_facts: {
        Row: {
          created_at: string
          created_by: string
          day_status: string
          flow: string | null
          id: string
          note: string | null
          org_id: string
          shift_type: string | null
          trips_count: number | null
          volume_m3: number | null
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          day_status?: string
          flow?: string | null
          id?: string
          note?: string | null
          org_id?: string
          shift_type?: string | null
          trips_count?: number | null
          volume_m3?: number | null
          work_date: string
        }
        Update: {
          created_at?: string
          created_by?: string
          day_status?: string
          flow?: string | null
          id?: string
          note?: string | null
          org_id?: string
          shift_type?: string | null
          trips_count?: number | null
          volume_m3?: number | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_facts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          contractor_id: string | null
          created_at: string
          full_name: string | null
          id: string
          org_id: string
          roles: string[]
        }
        Insert: {
          contractor_id?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          org_id: string
          roles?: string[]
        }
        Update: {
          contractor_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          org_id?: string
          roles?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          created_at: string
          distance_km: number | null
          id: string
          is_active: boolean
          material: string | null
          name: string
          org_id: string
          require_signature: boolean
          volume_m3: number | null
        }
        Insert: {
          created_at?: string
          distance_km?: number | null
          id?: string
          is_active?: boolean
          material?: string | null
          name: string
          org_id?: string
          require_signature?: boolean
          volume_m3?: number | null
        }
        Update: {
          created_at?: string
          distance_km?: number | null
          id?: string
          is_active?: boolean
          material?: string | null
          name?: string
          org_id?: string
          require_signature?: boolean
          volume_m3?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "routes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_journals: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string
          id: string
          itr_signature_url: string | null
          org_id: string
          shift_date: string
          shift_type: string
          status: string
          work_type_id: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          itr_signature_url?: string | null
          org_id?: string
          shift_date: string
          shift_type: string
          status?: string
          work_type_id?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          itr_signature_url?: string | null
          org_id?: string
          shift_date?: string
          shift_type?: string
          status?: string
          work_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_journals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_journals_work_type_id_fkey"
            columns: ["work_type_id"]
            isOneToOne: false
            referencedRelation: "work_types"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_records: {
        Row: {
          created_at: string
          driver_id: string
          driver_signature_url: string | null
          hours: number
          id: string
          itr_id: string
          itr_signature_url: string | null
          journal_id: string | null
          org_id: string
          shift_date: string
          shift_type: string
          vehicle_id: string
          work_type_id: string | null
        }
        Insert: {
          created_at?: string
          driver_id: string
          driver_signature_url?: string | null
          hours: number
          id?: string
          itr_id?: string
          itr_signature_url?: string | null
          journal_id?: string | null
          org_id?: string
          shift_date: string
          shift_type: string
          vehicle_id: string
          work_type_id?: string | null
        }
        Update: {
          created_at?: string
          driver_id?: string
          driver_signature_url?: string | null
          hours?: number
          id?: string
          itr_id?: string
          itr_signature_url?: string | null
          journal_id?: string | null
          org_id?: string
          shift_date?: string
          shift_type?: string
          vehicle_id?: string
          work_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_records_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_records_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "shift_journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_records_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_records_work_type_id_fkey"
            columns: ["work_type_id"]
            isOneToOne: false
            referencedRelation: "work_types"
            referencedColumns: ["id"]
          },
        ]
      }
      tanker_measurements: {
        Row: {
          calculated_liters: number
          created_at: string
          created_by: string
          id: string
          measured_liters: number
          note: string | null
          org_id: string
          tanker_id: string
        }
        Insert: {
          calculated_liters: number
          created_at?: string
          created_by?: string
          id?: string
          measured_liters: number
          note?: string | null
          org_id?: string
          tanker_id: string
        }
        Update: {
          calculated_liters?: number
          created_at?: string
          created_by?: string
          id?: string
          measured_liters?: number
          note?: string | null
          org_id?: string
          tanker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tanker_measurements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tanker_measurements_tanker_id_fkey"
            columns: ["tanker_id"]
            isOneToOne: false
            referencedRelation: "tanker_balances"
            referencedColumns: ["tanker_id"]
          },
          {
            foreignKeyName: "tanker_measurements_tanker_id_fkey"
            columns: ["tanker_id"]
            isOneToOne: false
            referencedRelation: "tankers"
            referencedColumns: ["id"]
          },
        ]
      }
      tanker_refills: {
        Row: {
          created_at: string
          created_by: string
          fuel_card_id: string | null
          id: string
          liters: number
          org_id: string
          price_per_liter: number | null
          receipt_photo_url: string | null
          source: string | null
          tanker_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          fuel_card_id?: string | null
          id?: string
          liters: number
          org_id?: string
          price_per_liter?: number | null
          receipt_photo_url?: string | null
          source?: string | null
          tanker_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          fuel_card_id?: string | null
          id?: string
          liters?: number
          org_id?: string
          price_per_liter?: number | null
          receipt_photo_url?: string | null
          source?: string | null
          tanker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tanker_refills_fuel_card_id_fkey"
            columns: ["fuel_card_id"]
            isOneToOne: false
            referencedRelation: "fuel_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tanker_refills_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tanker_refills_tanker_id_fkey"
            columns: ["tanker_id"]
            isOneToOne: false
            referencedRelation: "tanker_balances"
            referencedColumns: ["tanker_id"]
          },
          {
            foreignKeyName: "tanker_refills_tanker_id_fkey"
            columns: ["tanker_id"]
            isOneToOne: false
            referencedRelation: "tankers"
            referencedColumns: ["id"]
          },
        ]
      }
      tankers: {
        Row: {
          capacity_liters: number | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
        }
        Insert: {
          capacity_liters?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id?: string
        }
        Update: {
          capacity_liters?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tankers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_lineup_vehicles: {
        Row: {
          added_at: string
          added_by: string
          id: string
          lineup_id: string
          org_id: string
          vehicle_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string
          id?: string
          lineup_id: string
          org_id?: string
          vehicle_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          id?: string
          lineup_id?: string
          org_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_lineup_vehicles_lineup_id_fkey"
            columns: ["lineup_id"]
            isOneToOne: false
            referencedRelation: "trip_lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_lineup_vehicles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_lineup_vehicles_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_lineups: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string
          id: string
          master_signature_url: string | null
          org_id: string
          shift_type: string
          status: string
          work_date: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          master_signature_url?: string | null
          org_id?: string
          shift_type: string
          status?: string
          work_date: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          master_signature_url?: string | null
          org_id?: string
          shift_type?: string
          status?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_lineups_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_records: {
        Row: {
          created_at: string
          driver_id: string
          driver_signature_url: string | null
          geo_lat: number | null
          geo_lng: number | null
          id: string
          lineup_id: string | null
          org_id: string
          recorded_by: string
          route_id: string
          source: string
          tapped_at: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          driver_signature_url?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          lineup_id?: string | null
          org_id?: string
          recorded_by?: string
          route_id: string
          source?: string
          tapped_at?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          driver_signature_url?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          lineup_id?: string | null
          org_id?: string
          recorded_by?: string
          route_id?: string
          source?: string
          tapped_at?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_records_lineup_id_fkey"
            columns: ["lineup_id"]
            isOneToOne: false
            referencedRelation: "trip_lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_records_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_records_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_records_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          accounting_type: string
          approved_from: string | null
          approved_to: string | null
          brand: string
          contract_id: string | null
          contractor_id: string | null
          created_at: string
          day_driver_id: string | null
          fuel_norm_per_hour: number | null
          id: string
          is_active: boolean
          night_driver_id: string | null
          org_id: string
          qr_code: string | null
          reg_number: string
          source: string
          vehicle_type: string
        }
        Insert: {
          accounting_type: string
          approved_from?: string | null
          approved_to?: string | null
          brand: string
          contract_id?: string | null
          contractor_id?: string | null
          created_at?: string
          day_driver_id?: string | null
          fuel_norm_per_hour?: number | null
          id?: string
          is_active?: boolean
          night_driver_id?: string | null
          org_id?: string
          qr_code?: string | null
          reg_number: string
          source?: string
          vehicle_type: string
        }
        Update: {
          accounting_type?: string
          approved_from?: string | null
          approved_to?: string | null
          brand?: string
          contract_id?: string | null
          contractor_id?: string | null
          created_at?: string
          day_driver_id?: string | null
          fuel_norm_per_hour?: number | null
          id?: string
          is_active?: boolean
          night_driver_id?: string | null
          org_id?: string
          qr_code?: string | null
          reg_number?: string
          source?: string
          vehicle_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_day_driver_id_fkey"
            columns: ["day_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_night_driver_id_fkey"
            columns: ["night_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      work_types: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      tanker_balances: {
        Row: {
          calculated_liters: number | null
          last_measured_at: string | null
          last_measured_liters: number | null
          name: string | null
          org_id: string | null
          tanker_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tankers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_contractor_id: { Args: never; Returns: string }
      current_org_id: { Args: never; Returns: string }
      detect_all_anomalies: { Args: never; Returns: undefined }
      detect_anomalies: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: number
      }
      has_any_role: { Args: { role_names: string[] }; Returns: boolean }
      has_role: { Args: { role_name: string }; Returns: boolean }
      my_contract_ids: { Args: never; Returns: string[] }
      my_vehicle_ids: { Args: never; Returns: string[] }
      recompute_anomalies: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
