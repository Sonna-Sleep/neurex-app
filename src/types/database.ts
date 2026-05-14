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
      devices: {
        Row: {
          claimed_at: string
          color_variant: string | null
          firmware_version: string | null
          hardware_id: string
          id: string
          last_seen_at: string | null
          owner_user_id: string
        }
        Insert: {
          claimed_at?: string
          color_variant?: string | null
          firmware_version?: string | null
          hardware_id: string
          id?: string
          last_seen_at?: string | null
          owner_user_id: string
        }
        Update: {
          claimed_at?: string
          color_variant?: string | null
          firmware_version?: string | null
          hardware_id?: string
          id?: string
          last_seen_at?: string | null
          owner_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          current_period_end: string | null
          plan: string
          revenuecat_app_user_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          current_period_end?: string | null
          plan?: string
          revenuecat_app_user_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          current_period_end?: string | null
          plan?: string
          revenuecat_app_user_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pro_waitlist: {
        Row: {
          email: string
          id: string
          signed_up_at: string
          user_id: string | null
        }
        Insert: {
          email: string
          id?: string
          signed_up_at?: string
          user_id?: string | null
        }
        Update: {
          email?: string
          id?: string
          signed_up_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pro_waitlist_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pulses: {
        Row: {
          amplitude_db: number | null
          frequency: number | null
          id: number
          on_target: boolean
          phase_deg: number | null
          session_id: string
          ts_ms: number
        }
        Insert: {
          amplitude_db?: number | null
          frequency?: number | null
          id?: number
          on_target?: boolean
          phase_deg?: number | null
          session_id: string
          ts_ms: number
        }
        Update: {
          amplitude_db?: number | null
          frequency?: number | null
          id?: number
          on_target?: boolean
          phase_deg?: number | null
          session_id?: string
          ts_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "pulses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          expo_push_token: string
          id: string
          platform: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expo_push_token: string
          id?: string
          platform: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expo_push_token?: string
          id?: string
          platform?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      recordings: {
        Row: {
          bytes: number | null
          chunk_idx: number
          created_at: string
          id: string
          session_id: string
          sha256: string | null
          state: string
          storage_path: string | null
        }
        Insert: {
          bytes?: number | null
          chunk_idx: number
          created_at?: string
          id?: string
          session_id: string
          sha256?: string | null
          state?: string
          storage_path?: string | null
        }
        Update: {
          bytes?: number | null
          chunk_idx?: number
          created_at?: string
          id?: string
          session_id?: string
          sha256?: string | null
          state?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recordings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      score_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      sessions: {
        Row: {
          awakenings: number | null
          created_at: string
          day_assigned: string
          device_id: string | null
          end_ts: string | null
          id: string
          journal_tags: string[] | null
          latency_s: number | null
          min_in_deep: number | null
          min_in_light: number | null
          min_in_rem: number | null
          min_in_wake: number | null
          sleep_efficiency: number | null
          sleep_score: number | null
          sleep_strip: Json | null
          start_ts: string
          state: string
          stim_count: number | null
          stim_swa_pct: number | null
          time_asleep_s: number | null
          time_in_bed_s: number | null
          user_id: string
        }
        Insert: {
          awakenings?: number | null
          created_at?: string
          day_assigned: string
          device_id?: string | null
          end_ts?: string | null
          id?: string
          journal_tags?: string[] | null
          latency_s?: number | null
          min_in_deep?: number | null
          min_in_light?: number | null
          min_in_rem?: number | null
          min_in_wake?: number | null
          sleep_efficiency?: number | null
          sleep_score?: number | null
          sleep_strip?: Json | null
          start_ts: string
          state?: string
          stim_count?: number | null
          stim_swa_pct?: number | null
          time_asleep_s?: number | null
          time_in_bed_s?: number | null
          user_id: string
        }
        Update: {
          awakenings?: number | null
          created_at?: string
          day_assigned?: string
          device_id?: string | null
          end_ts?: string | null
          id?: string
          journal_tags?: string[] | null
          latency_s?: number | null
          min_in_deep?: number | null
          min_in_light?: number | null
          min_in_rem?: number | null
          min_in_wake?: number | null
          sleep_efficiency?: number | null
          sleep_score?: number | null
          sleep_strip?: Json | null
          start_ts?: string
          state?: string
          stim_count?: number | null
          stim_swa_pct?: number | null
          time_asleep_s?: number | null
          time_in_bed_s?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          bedtime_reminder_local: string | null
          created_at: string
          deleted_at: string | null
          dob: string | null
          email: string
          height_cm: number | null
          id: string
          sex: string | null
          sleep_goal_min: number | null
          timezone: string | null
          weight_kg: number | null
        }
        Insert: {
          bedtime_reminder_local?: string | null
          created_at?: string
          deleted_at?: string | null
          dob?: string | null
          email: string
          height_cm?: number | null
          id: string
          sex?: string | null
          sleep_goal_min?: number | null
          timezone?: string | null
          weight_kg?: number | null
        }
        Update: {
          bedtime_reminder_local?: string | null
          created_at?: string
          deleted_at?: string | null
          dob?: string | null
          email?: string
          height_cm?: number | null
          id?: string
          sex?: string | null
          sleep_goal_min?: number | null
          timezone?: string | null
          weight_kg?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
