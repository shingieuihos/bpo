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
      assets: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          embedding_model: string | null
          id: string
          is_seed: boolean
          niche_id: string | null
          org_id: string
          title: string
          type: Database["public"]["Enums"]["asset_type"]
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          is_seed?: boolean
          niche_id?: string | null
          org_id: string
          title: string
          type: Database["public"]["Enums"]["asset_type"]
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          is_seed?: boolean
          niche_id?: string | null
          org_id?: string
          title?: string
          type?: Database["public"]["Enums"]["asset_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_niche_id_fkey"
            columns: ["niche_id"]
            isOneToOne: false
            referencedRelation: "niches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          org_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          org_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          contact: Json
          created_at: string
          data_classification: Database["public"]["Enums"]["data_classification"]
          first_won_at: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          source: string | null
          updated_at: string
        }
        Insert: {
          contact?: Json
          created_at?: string
          data_classification?: Database["public"]["Enums"]["data_classification"]
          first_won_at?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          source?: string | null
          updated_at?: string
        }
        Update: {
          contact?: Json
          created_at?: string
          data_classification?: Database["public"]["Enums"]["data_classification"]
          first_won_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contractors: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
          notes: string | null
          org_id: string
          rate: number | null
          rating: number | null
          skills: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
          notes?: string | null
          org_id: string
          rate?: number | null
          rating?: number | null
          skills?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          rate?: number | null
          rating?: number | null
          skills?: string[]
          updated_at?: string
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
      deals: {
        Row: {
          actual_delivery_cost: number | null
          client_id: string | null
          created_at: string
          currency: string
          estimated_delivery_cost: number | null
          gross_margin: number | null
          id: string
          next_action_at: string | null
          next_action_note: string | null
          opportunity_id: string | null
          org_id: string
          stage: Database["public"]["Enums"]["deal_stage"]
          updated_at: string
          value: number | null
          win_probability: number | null
          won_at: string | null
        }
        Insert: {
          actual_delivery_cost?: number | null
          client_id?: string | null
          created_at?: string
          currency?: string
          estimated_delivery_cost?: number | null
          gross_margin?: number | null
          id?: string
          next_action_at?: string | null
          next_action_note?: string | null
          opportunity_id?: string | null
          org_id: string
          stage?: Database["public"]["Enums"]["deal_stage"]
          updated_at?: string
          value?: number | null
          win_probability?: number | null
          won_at?: string | null
        }
        Update: {
          actual_delivery_cost?: number | null
          client_id?: string | null
          created_at?: string
          currency?: string
          estimated_delivery_cost?: number | null
          gross_margin?: number | null
          id?: string
          next_action_at?: string | null
          next_action_note?: string | null
          opportunity_id?: string | null
          org_id?: string
          stage?: Database["public"]["Enums"]["deal_stage"]
          updated_at?: string
          value?: number | null
          win_probability?: number | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_lifetime_value"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "deals_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_jobs: {
        Row: {
          assignee_ref: string | null
          assignee_type: Database["public"]["Enums"]["assignee_type"] | null
          brief: string | null
          created_at: string
          deal_id: string
          id: string
          org_id: string
          qa_notes: string | null
          qa_status: Database["public"]["Enums"]["qa_status"]
          status: Database["public"]["Enums"]["delivery_job_status"]
          tasks: Json
          updated_at: string
        }
        Insert: {
          assignee_ref?: string | null
          assignee_type?: Database["public"]["Enums"]["assignee_type"] | null
          brief?: string | null
          created_at?: string
          deal_id: string
          id?: string
          org_id: string
          qa_notes?: string | null
          qa_status?: Database["public"]["Enums"]["qa_status"]
          status?: Database["public"]["Enums"]["delivery_job_status"]
          tasks?: Json
          updated_at?: string
        }
        Update: {
          assignee_ref?: string | null
          assignee_type?: Database["public"]["Enums"]["assignee_type"] | null
          brief?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          org_id?: string
          qa_notes?: string | null
          qa_status?: Database["public"]["Enums"]["qa_status"]
          status?: Database["public"]["Enums"]["delivery_job_status"]
          tasks?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_jobs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_queue: {
        Row: {
          attempts: number
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          max_attempts: number
          org_id: string
          payload: Json
          run_after: string
          status: Database["public"]["Enums"]["queue_job_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          job_type: string
          last_error?: string | null
          max_attempts?: number
          org_id: string
          payload?: Json
          run_after?: string
          status?: Database["public"]["Enums"]["queue_job_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          job_type?: string
          last_error?: string | null
          max_attempts?: number
          org_id?: string
          payload?: Json
          run_after?: string
          status?: Database["public"]["Enums"]["queue_job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_queue_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      niches: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          positioning_notes: string | null
          pricing_model: string | null
          sop_ref: string | null
          target_margin: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
          positioning_notes?: string | null
          pricing_model?: string | null
          sop_ref?: string | null
          target_margin?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          positioning_notes?: string | null
          pricing_model?: string | null
          sop_ref?: string | null
          target_margin?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "niches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          budget: number | null
          created_at: string
          currency: string
          dedup_key: string | null
          description: string | null
          effort_score: number | null
          fit_score: number | null
          id: string
          is_seed: boolean
          margin_potential_score: number | null
          niche_id: string | null
          org_id: string
          raw_payload: Json | null
          score_rationale: string | null
          scored_at: string | null
          source: Database["public"]["Enums"]["opportunity_source"]
          source_ref: string | null
          status: Database["public"]["Enums"]["opportunity_status"]
          title: string
          updated_at: string
          urgency_score: number | null
          url: string | null
        }
        Insert: {
          budget?: number | null
          created_at?: string
          currency?: string
          dedup_key?: string | null
          description?: string | null
          effort_score?: number | null
          fit_score?: number | null
          id?: string
          is_seed?: boolean
          margin_potential_score?: number | null
          niche_id?: string | null
          org_id: string
          raw_payload?: Json | null
          score_rationale?: string | null
          scored_at?: string | null
          source: Database["public"]["Enums"]["opportunity_source"]
          source_ref?: string | null
          status?: Database["public"]["Enums"]["opportunity_status"]
          title: string
          updated_at?: string
          urgency_score?: number | null
          url?: string | null
        }
        Update: {
          budget?: number | null
          created_at?: string
          currency?: string
          dedup_key?: string | null
          description?: string | null
          effort_score?: number | null
          fit_score?: number | null
          id?: string
          is_seed?: boolean
          margin_potential_score?: number | null
          niche_id?: string | null
          org_id?: string
          raw_payload?: Json | null
          score_rationale?: string | null
          scored_at?: string | null
          source?: Database["public"]["Enums"]["opportunity_source"]
          source_ref?: string | null
          status?: Database["public"]["Enums"]["opportunity_status"]
          title?: string
          updated_at?: string
          urgency_score?: number | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_niche_id_fkey"
            columns: ["niche_id"]
            isOneToOne: false
            referencedRelation: "niches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
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
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      proposals: {
        Row: {
          approved_by: string | null
          created_at: string
          draft: string | null
          final: string | null
          id: string
          opportunity_id: string
          org_id: string
          outcome: Database["public"]["Enums"]["proposal_outcome"]
          sent_at: string | null
          status: Database["public"]["Enums"]["proposal_status"]
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          draft?: string | null
          final?: string | null
          id?: string
          opportunity_id: string
          org_id: string
          outcome?: Database["public"]["Enums"]["proposal_outcome"]
          sent_at?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          draft?: string | null
          final?: string | null
          id?: string
          opportunity_id?: string
          org_id?: string
          outcome?: Database["public"]["Enums"]["proposal_outcome"]
          sent_at?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposals_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_client_lifetime_value: {
        Row: {
          client_id: string | null
          lifetime_value: number | null
          name: string | null
          org_id: string | null
          won_deals: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      claim_queue_jobs: {
        Args: { p_job_type: string; p_limit: number }
        Returns: {
          attempts: number
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          max_attempts: number
          org_id: string
          payload: Json
          run_after: string
          status: Database["public"]["Enums"]["queue_job_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "job_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      match_assets: {
        Args: {
          p_embedding: string
          p_limit?: number
          p_niche_id?: string
          p_org_id: string
        }
        Returns: {
          content: string
          id: string
          niche_id: string
          similarity: number
          title: string
          type: Database["public"]["Enums"]["asset_type"]
        }[]
      }
    }
    Enums: {
      asset_type:
        | "case_study"
        | "winning_proposal"
        | "pricing_framework"
        | "tone_sample"
      assignee_type: "ai" | "contractor"
      data_classification: "general" | "personal_data" | "special_personal_data"
      deal_stage:
        | "qualifying"
        | "negotiation"
        | "contract_sent"
        | "won"
        | "lost"
      delivery_job_status:
        | "draft"
        | "in_progress"
        | "qa"
        | "delivered"
        | "cancelled"
      opportunity_source:
        | "marketplace_api"
        | "alert_email"
        | "owned_inbound"
        | "outbound"
      opportunity_status:
        | "new"
        | "scored"
        | "drafting"
        | "proposed"
        | "won"
        | "lost"
        | "archived"
      org_role: "owner" | "admin" | "member"
      proposal_outcome:
        | "pending"
        | "reply"
        | "shortlisted"
        | "won"
        | "lost"
        | "no_response"
      proposal_status: "draft" | "approved" | "sent" | "archived"
      qa_status: "pending" | "passed" | "rework"
      queue_job_status: "pending" | "processing" | "done" | "failed"
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
    Enums: {
      asset_type: [
        "case_study",
        "winning_proposal",
        "pricing_framework",
        "tone_sample",
      ],
      assignee_type: ["ai", "contractor"],
      data_classification: [
        "general",
        "personal_data",
        "special_personal_data",
      ],
      deal_stage: ["qualifying", "negotiation", "contract_sent", "won", "lost"],
      delivery_job_status: [
        "draft",
        "in_progress",
        "qa",
        "delivered",
        "cancelled",
      ],
      opportunity_source: [
        "marketplace_api",
        "alert_email",
        "owned_inbound",
        "outbound",
      ],
      opportunity_status: [
        "new",
        "scored",
        "drafting",
        "proposed",
        "won",
        "lost",
        "archived",
      ],
      org_role: ["owner", "admin", "member"],
      proposal_outcome: [
        "pending",
        "reply",
        "shortlisted",
        "won",
        "lost",
        "no_response",
      ],
      proposal_status: ["draft", "approved", "sent", "archived"],
      qa_status: ["pending", "passed", "rework"],
      queue_job_status: ["pending", "processing", "done", "failed"],
    },
  },
} as const
