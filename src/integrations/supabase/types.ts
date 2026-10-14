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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      backoffice_invitations: {
        Row: {
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string
          role: string
          token: string
          used_at: string | null
          used_by_member_id: string | null
          zone: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          role?: string
          token?: string
          used_at?: string | null
          used_by_member_id?: string | null
          zone?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          role?: string
          token?: string
          used_at?: string | null
          used_by_member_id?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "backoffice_invitations_used_by_member_id_fkey"
            columns: ["used_by_member_id"]
            isOneToOne: false
            referencedRelation: "backoffice_members"
            referencedColumns: ["id"]
          },
        ]
      }
      backoffice_members: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          id: string
          is_active: boolean | null
          last_access_at: string | null
          name: string
          phone: string | null
          role: string
          user_id: string | null
          zone: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          id?: string
          is_active?: boolean | null
          last_access_at?: string | null
          name: string
          phone?: string | null
          role?: string
          user_id?: string | null
          zone?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          id?: string
          is_active?: boolean | null
          last_access_at?: string | null
          name?: string
          phone?: string | null
          role?: string
          user_id?: string | null
          zone?: string | null
        }
        Relationships: []
      }
      bill_requests: {
        Row: {
          attended_at: string | null
          attended_by: string | null
          branch_id: string
          id: string
          requested_at: string | null
          session_id: string
          status: string | null
          table_id: string
          tenant_id: string
          tip_amount: number | null
          tip_percentage: number | null
          total_amount: number
          user_id: string | null
        }
        Insert: {
          attended_at?: string | null
          attended_by?: string | null
          branch_id: string
          id?: string
          requested_at?: string | null
          session_id: string
          status?: string | null
          table_id: string
          tenant_id: string
          tip_amount?: number | null
          tip_percentage?: number | null
          total_amount: number
          user_id?: string | null
        }
        Update: {
          attended_at?: string | null
          attended_by?: string | null
          branch_id?: string
          id?: string
          requested_at?: string | null
          session_id?: string
          status?: string | null
          table_id?: string
          tenant_id?: string
          tip_amount?: number | null
          tip_percentage?: number | null
          total_amount?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bill_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_requests_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          city: string | null
          corte_dia: string
          created_at: string | null
          id: string
          is_open: boolean | null
          limite_cuenta_persona: number
          name: string
          objetivo_llamado_min: number
          objetivo_pedido_min: number
          objetivo_retiro_min: number
          opening_hours: Json | null
          pagos_simulados: boolean
          payment_mode: string
          pedir_codigo: string
          phone: string | null
          restaurant_id: string
          tenant_id: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          corte_dia?: string
          created_at?: string | null
          id?: string
          is_open?: boolean | null
          limite_cuenta_persona?: number
          name: string
          objetivo_llamado_min?: number
          objetivo_pedido_min?: number
          objetivo_retiro_min?: number
          opening_hours?: Json | null
          pagos_simulados?: boolean
          payment_mode?: string
          pedir_codigo?: string
          phone?: string | null
          restaurant_id: string
          tenant_id: string
        }
        Update: {
          address?: string | null
          city?: string | null
          corte_dia?: string
          created_at?: string | null
          id?: string
          is_open?: boolean | null
          limite_cuenta_persona?: number
          name?: string
          objetivo_llamado_min?: number
          objetivo_pedido_min?: number
          objetivo_retiro_min?: number
          opening_hours?: Json | null
          pagos_simulados?: boolean
          payment_mode?: string
          pedir_codigo?: string
          phone?: string | null
          restaurant_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          available_days: number[] | null
          available_from: string | null
          available_until: string | null
          created_at: string | null
          description: string | null
          emoji: string | null
          id: string
          is_visible: boolean | null
          menu_id: string
          name: string
          sort_order: number | null
          station_id: string | null
          tenant_id: string
        }
        Insert: {
          available_days?: number[] | null
          available_from?: string | null
          available_until?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_visible?: boolean | null
          menu_id: string
          name: string
          sort_order?: number | null
          station_id?: string | null
          tenant_id: string
        }
        Update: {
          available_days?: number[] | null
          available_from?: string | null
          available_until?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_visible?: boolean | null
          menu_id?: string
          name?: string
          sort_order?: number | null
          station_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      codigos_mesa: {
        Row: {
          branch_id: string
          cambiado_at: string
          codigo: string
          table_id: string
          tenant_id: string
        }
        Insert: {
          branch_id: string
          cambiado_at?: string
          codigo?: string
          table_id: string
          tenant_id: string
        }
        Update: {
          branch_id?: string
          cambiado_at?: string
          codigo?: string
          table_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "codigos_mesa_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "codigos_mesa_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: true
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "codigos_mesa_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      comensales_mesa: {
        Row: {
          alias: string | null
          branch_id: string
          codigo_bloqueado_hasta: string | null
          created_at: string
          id: string
          intentos_codigo: number
          presencia_ok_at: string | null
          session_id: string
          table_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          alias?: string | null
          branch_id: string
          codigo_bloqueado_hasta?: string | null
          created_at?: string
          id?: string
          intentos_codigo?: number
          presencia_ok_at?: string | null
          session_id: string
          table_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          alias?: string | null
          branch_id?: string
          codigo_bloqueado_hasta?: string | null
          created_at?: string
          id?: string
          intentos_codigo?: number
          presencia_ok_at?: string | null
          session_id?: string
          table_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comensales_mesa_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comensales_mesa_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comensales_mesa_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comensales_mesa_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conexiones_pago: {
        Row: {
          ambiente: string
          branch_id: string
          conectado_por: string | null
          conectado_por_nombre: string | null
          created_at: string
          desconectado_at: string | null
          estado: string
          etiqueta: string
          id: string
          proveedor: string
          secreto_id: string | null
          tenant_id: string
          verificado_at: string | null
        }
        Insert: {
          ambiente: string
          branch_id: string
          conectado_por?: string | null
          conectado_por_nombre?: string | null
          created_at?: string
          desconectado_at?: string | null
          estado?: string
          etiqueta: string
          id?: string
          proveedor: string
          secreto_id?: string | null
          tenant_id: string
          verificado_at?: string | null
        }
        Update: {
          ambiente?: string
          branch_id?: string
          conectado_por?: string | null
          conectado_por_nombre?: string | null
          created_at?: string
          desconectado_at?: string | null
          estado?: string
          etiqueta?: string
          id?: string
          proveedor?: string
          secreto_id?: string | null
          tenant_id?: string
          verificado_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conexiones_pago_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conexiones_pago_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracion_tablio: {
        Row: {
          clave: string
          updated_at: string
          updated_by: string | null
          valor: Json
        }
        Insert: {
          clave: string
          updated_at?: string
          updated_by?: string | null
          valor: Json
        }
        Update: {
          clave?: string
          updated_at?: string
          updated_by?: string | null
          valor?: Json
        }
        Relationships: []
      }
      contadores_pedidos: {
        Row: {
          branch_id: string
          ultimo: number
        }
        Insert: {
          branch_id: string
          ultimo?: number
        }
        Update: {
          branch_id?: string
          ultimo?: number
        }
        Relationships: [
          {
            foreignKeyName: "contadores_pedidos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizaciones: {
        Row: {
          branch_id: string
          created_at: string
          estado: string
          expira_at: string
          id: string
          items: Json | null
          notas: string | null
          order_ids: string[] | null
          subtotal: number
          table_id: string
          tenant_id: string
          tipo: string
          user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          estado?: string
          expira_at?: string
          id?: string
          items?: Json | null
          notas?: string | null
          order_ids?: string[] | null
          subtotal: number
          table_id: string
          tenant_id: string
          tipo: string
          user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          estado?: string
          expira_at?: string
          id?: string
          items?: Json | null
          notas?: string | null
          order_ids?: string[] | null
          subtotal?: number
          table_id?: string
          tenant_id?: string
          tipo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string | null
          default_enabled: boolean | null
          description: string | null
          id: string
          key: string
        }
        Insert: {
          created_at?: string | null
          default_enabled?: boolean | null
          description?: string | null
          id?: string
          key: string
        }
        Update: {
          created_at?: string | null
          default_enabled?: boolean | null
          description?: string | null
          id?: string
          key?: string
        }
        Relationships: []
      }
      gastos_tablio: {
        Row: {
          categoria: string
          creado_por: string | null
          created_at: string
          descripcion: string
          fecha: string
          id: string
          monto: number
        }
        Insert: {
          categoria: string
          creado_por?: string | null
          created_at?: string
          descripcion: string
          fecha?: string
          id?: string
          monto: number
        }
        Update: {
          categoria?: string
          creado_por?: string | null
          created_at?: string
          descripcion?: string
          fecha?: string
          id?: string
          monto?: number
        }
        Relationships: []
      }
      intentos_pago: {
        Row: {
          conexion_id: string | null
          cotizacion_id: string
          created_at: string
          estado: string
          id: string
          idempotency_key: string
          metodo: string
          monto: number
          motivo: string | null
          payment_id: string | null
          propina: number
          proveedor: string | null
          referencia_externa: string | null
          resuelto_at: string | null
          tenant_id: string
          token_externo: string | null
          user_id: string
        }
        Insert: {
          conexion_id?: string | null
          cotizacion_id: string
          created_at?: string
          estado?: string
          id?: string
          idempotency_key: string
          metodo: string
          monto: number
          motivo?: string | null
          payment_id?: string | null
          propina?: number
          proveedor?: string | null
          referencia_externa?: string | null
          resuelto_at?: string | null
          tenant_id: string
          token_externo?: string | null
          user_id: string
        }
        Update: {
          conexion_id?: string | null
          cotizacion_id?: string
          created_at?: string
          estado?: string
          id?: string
          idempotency_key?: string
          metodo?: string
          monto?: number
          motivo?: string | null
          payment_id?: string | null
          propina?: number
          proveedor?: string | null
          referencia_externa?: string | null
          resuelto_at?: string | null
          tenant_id?: string
          token_externo?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intentos_pago_conexion_id_fkey"
            columns: ["conexion_id"]
            isOneToOne: false
            referencedRelation: "conexiones_pago"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intentos_pago_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intentos_pago_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intentos_pago_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          lead_id: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          lead_id: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          lead_id?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          assigned_seller_id: string | null
          converted_tenant_id: string | null
          created_at: string | null
          demo_date: string | null
          email: string | null
          id: string
          lost_reason: string | null
          monthly_value: number | null
          next_action: string | null
          next_action_date: string | null
          notes: string | null
          owner_name: string | null
          phone: string | null
          pilot_end_date: string | null
          pilot_start_date: string | null
          restaurant_name: string
          source: string | null
          stage: string
          temperature: string | null
          updated_at: string | null
          zone: string | null
        }
        Insert: {
          address?: string | null
          assigned_seller_id?: string | null
          converted_tenant_id?: string | null
          created_at?: string | null
          demo_date?: string | null
          email?: string | null
          id?: string
          lost_reason?: string | null
          monthly_value?: number | null
          next_action?: string | null
          next_action_date?: string | null
          notes?: string | null
          owner_name?: string | null
          phone?: string | null
          pilot_end_date?: string | null
          pilot_start_date?: string | null
          restaurant_name: string
          source?: string | null
          stage?: string
          temperature?: string | null
          updated_at?: string | null
          zone?: string | null
        }
        Update: {
          address?: string | null
          assigned_seller_id?: string | null
          converted_tenant_id?: string | null
          created_at?: string | null
          demo_date?: string | null
          email?: string | null
          id?: string
          lost_reason?: string | null
          monthly_value?: number | null
          next_action?: string | null
          next_action_date?: string | null
          notes?: string | null
          owner_name?: string | null
          phone?: string | null
          pilot_end_date?: string | null
          pilot_start_date?: string | null
          restaurant_name?: string
          source?: string | null
          stage?: string
          temperature?: string | null
          updated_at?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_seller_id_fkey"
            columns: ["assigned_seller_id"]
            isOneToOne: false
            referencedRelation: "backoffice_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_converted_tenant_id_fkey"
            columns: ["converted_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      liquidaciones_propina: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          medio: string
          monto: number
          nota: string | null
          pagado_por: string | null
          pagado_por_nombre: string | null
          pagos: string[]
          staff_id: string
          tenant_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          medio: string
          monto: number
          nota?: string | null
          pagado_por?: string | null
          pagado_por_nombre?: string | null
          pagos: string[]
          staff_id: string
          tenant_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          medio?: string
          monto?: number
          nota?: string | null
          pagado_por?: string | null
          pagado_por_nombre?: string | null
          pagos?: string[]
          staff_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "liquidaciones_propina_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liquidaciones_propina_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liquidaciones_propina_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_customers: {
        Row: {
          consent_at: string
          created_at: string
          email: string
          id: string
          last_visit_at: string | null
          points: number
          tenant_id: string
          total_spent: number
          updated_at: string
          user_id: string | null
          visits: number
        }
        Insert: {
          consent_at?: string
          created_at?: string
          email: string
          id?: string
          last_visit_at?: string | null
          points?: number
          tenant_id: string
          total_spent?: number
          updated_at?: string
          user_id?: string | null
          visits?: number
        }
        Update: {
          consent_at?: string
          created_at?: string
          email?: string
          id?: string
          last_visit_at?: string | null
          points?: number
          tenant_id?: string
          total_spent?: number
          updated_at?: string
          user_id?: string | null
          visits?: number
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_programs: {
        Row: {
          branch_id: string | null
          created_at: string
          goal_visits: number
          id: string
          is_active: boolean
          monto_minimo: number
          points_goal: number
          points_per_thousand: number
          reward_description: string
          tenant_id: string
          type: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          goal_visits?: number
          id?: string
          is_active?: boolean
          monto_minimo?: number
          points_goal?: number
          points_per_thousand?: number
          reward_description?: string
          tenant_id: string
          type?: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          goal_visits?: number
          id?: string
          is_active?: boolean
          monto_minimo?: number
          points_goal?: number
          points_per_thousand?: number
          reward_description?: string
          tenant_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_programs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_programs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_rewards: {
        Row: {
          anulado_at: string | null
          codigo: string | null
          created_at: string
          customer_id: string
          description: string
          earned_at: string
          entregado_por: string | null
          entregado_por_nombre: string | null
          id: string
          movimiento_id: string | null
          payment_id: string | null
          redeemed_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          anulado_at?: string | null
          codigo?: string | null
          created_at?: string
          customer_id: string
          description: string
          earned_at?: string
          entregado_por?: string | null
          entregado_por_nombre?: string | null
          id?: string
          movimiento_id?: string | null
          payment_id?: string | null
          redeemed_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          anulado_at?: string | null
          codigo?: string | null
          created_at?: string
          customer_id?: string
          description?: string
          earned_at?: string
          entregado_por?: string | null
          entregado_por_nombre?: string | null
          id?: string
          movimiento_id?: string | null
          payment_id?: string | null
          redeemed_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_rewards_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "loyalty_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_rewards_movimiento_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos_lealtad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_rewards_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_rewards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          allergens: string[] | null
          category_id: string
          cost_price: number | null
          created_at: string | null
          description_long: string | null
          description_short: string | null
          id: string
          image_is_real: boolean | null
          image_url: string | null
          labels: string[] | null
          name: string
          prep_time_minutes: number | null
          price: number
          sort_order: number | null
          status: string | null
          tenant_id: string
          total_orders: number | null
          updated_at: string | null
        }
        Insert: {
          allergens?: string[] | null
          category_id: string
          cost_price?: number | null
          created_at?: string | null
          description_long?: string | null
          description_short?: string | null
          id?: string
          image_is_real?: boolean | null
          image_url?: string | null
          labels?: string[] | null
          name: string
          prep_time_minutes?: number | null
          price: number
          sort_order?: number | null
          status?: string | null
          tenant_id: string
          total_orders?: number | null
          updated_at?: string | null
        }
        Update: {
          allergens?: string[] | null
          category_id?: string
          cost_price?: number | null
          created_at?: string | null
          description_long?: string | null
          description_short?: string | null
          id?: string
          image_is_real?: boolean | null
          image_url?: string | null
          labels?: string[] | null
          name?: string
          prep_time_minutes?: number | null
          price?: number
          sort_order?: number | null
          status?: string | null
          tenant_id?: string
          total_orders?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menus: {
        Row: {
          branch_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          tenant_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          tenant_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menus_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menus_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      metas_mozo: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          objetivo: number
          periodo: string
          staff_id: string | null
          tenant_id: string
          tipo: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          objetivo: number
          periodo: string
          staff_id?: string | null
          tenant_id: string
          tipo: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          objetivo?: number
          periodo?: string
          staff_id?: string | null
          tenant_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "metas_mozo_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_mozo_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_mozo_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          id: string
          max_selections: number | null
          menu_item_id: string
          min_selections: number | null
          name: string
          required: boolean | null
          sort_order: number | null
          tenant_id: string
          type: string
        }
        Insert: {
          id?: string
          max_selections?: number | null
          menu_item_id: string
          min_selections?: number | null
          name: string
          required?: boolean | null
          sort_order?: number | null
          tenant_id: string
          type: string
        }
        Update: {
          id?: string
          max_selections?: number | null
          menu_item_id?: string
          min_selections?: number | null
          name?: string
          required?: boolean | null
          sort_order?: number | null
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_groups_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifiers: {
        Row: {
          extra_price: number | null
          group_id: string
          id: string
          is_available: boolean | null
          name: string
          sort_order: number | null
          tenant_id: string
        }
        Insert: {
          extra_price?: number | null
          group_id: string
          id?: string
          is_available?: boolean | null
          name: string
          sort_order?: number | null
          tenant_id: string
        }
        Update: {
          extra_price?: number | null
          group_id?: string
          id?: string
          is_available?: boolean | null
          name?: string
          sort_order?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifiers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      movimientos_lealtad: {
        Row: {
          anulado_at: string | null
          branch_id: string | null
          created_at: string
          customer_id: string
          dia_negocio: string
          id: string
          monto: number
          payment_id: string
          premio_id: string | null
          puntos: number
          retroactivo: boolean
          sello: boolean
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          anulado_at?: string | null
          branch_id?: string | null
          created_at?: string
          customer_id: string
          dia_negocio: string
          id?: string
          monto?: number
          payment_id: string
          premio_id?: string | null
          puntos?: number
          retroactivo?: boolean
          sello?: boolean
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          anulado_at?: string | null
          branch_id?: string | null
          created_at?: string
          customer_id?: string
          dia_negocio?: string
          id?: string
          monto?: number
          payment_id?: string
          premio_id?: string | null
          puntos?: number
          retroactivo?: boolean
          sello?: boolean
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_lealtad_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_lealtad_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "loyalty_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_lealtad_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_lealtad_premio_id_fkey"
            columns: ["premio_id"]
            isOneToOne: false
            referencedRelation: "loyalty_rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_lealtad_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor_rol: string | null
          actor_user_id: string | null
          created_at: string
          estado_anterior: string | null
          estado_nuevo: string
          id: number
          motivo: string | null
          order_id: string
          productos: number
          station_id: string | null
          tenant_id: string
        }
        Insert: {
          actor_rol?: string | null
          actor_user_id?: string | null
          created_at?: string
          estado_anterior?: string | null
          estado_nuevo: string
          id?: never
          motivo?: string | null
          order_id: string
          productos?: number
          station_id?: string | null
          tenant_id: string
        }
        Update: {
          actor_rol?: string | null
          actor_user_id?: string | null
          created_at?: string
          estado_anterior?: string | null
          estado_nuevo?: string
          id?: never
          motivo?: string | null
          order_id?: string
          productos?: number
          station_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          avisado_at: string | null
          created_at: string | null
          delivered_at: string | null
          delivered_by: string | null
          id: string
          item_notes: string | null
          menu_item_id: string
          menu_item_name: string
          order_id: string
          quantity: number
          ready_at: string | null
          selected_modifiers: Json | null
          started_at: string | null
          station_id: string | null
          status: string
          subtotal: number
          tenant_id: string
          unit_price: number
        }
        Insert: {
          avisado_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivered_by?: string | null
          id?: string
          item_notes?: string | null
          menu_item_id: string
          menu_item_name: string
          order_id: string
          quantity?: number
          ready_at?: string | null
          selected_modifiers?: Json | null
          started_at?: string | null
          station_id?: string | null
          status?: string
          subtotal: number
          tenant_id: string
          unit_price: number
        }
        Update: {
          avisado_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivered_by?: string | null
          id?: string
          item_notes?: string | null
          menu_item_id?: string
          menu_item_name?: string
          order_id?: string
          quantity?: number
          ready_at?: string | null
          selected_modifiers?: Json | null
          started_at?: string | null
          station_id?: string | null
          status?: string
          subtotal?: number
          tenant_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          alerta: string | null
          branch_id: string
          cancelled_reason: string | null
          confirmed_at: string | null
          created_at: string | null
          delivered_at: string | null
          forma_pago: string | null
          id: string
          kitchen_accepted_at: string | null
          notes: string | null
          order_number: number
          paid_at: string | null
          payment_status: string
          perdido_at: string | null
          ready_at: string | null
          session_id: string
          source: string | null
          status: string | null
          table_id: string
          tenant_id: string
          total_amount: number
          user_id: string | null
        }
        Insert: {
          alerta?: string | null
          branch_id: string
          cancelled_reason?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          forma_pago?: string | null
          id?: string
          kitchen_accepted_at?: string | null
          notes?: string | null
          order_number: number
          paid_at?: string | null
          payment_status?: string
          perdido_at?: string | null
          ready_at?: string | null
          session_id: string
          source?: string | null
          status?: string | null
          table_id: string
          tenant_id: string
          total_amount: number
          user_id?: string | null
        }
        Update: {
          alerta?: string | null
          branch_id?: string
          cancelled_reason?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          forma_pago?: string | null
          id?: string
          kitchen_accepted_at?: string | null
          notes?: string | null
          order_number?: number
          paid_at?: string | null
          payment_status?: string
          perdido_at?: string | null
          ready_at?: string | null
          session_id?: string
          source?: string | null
          status?: string | null
          table_id?: string
          tenant_id?: string
          total_amount?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_settlements: {
        Row: {
          branch_id: string
          closed_at: string | null
          closed_by: string | null
          closed_by_name: string | null
          created_at: string
          detalle: Json
          diferencia_efectivo: number | null
          diferencia_pos: number | null
          difference: number
          efectivo_contado: number | null
          efectivo_esperado: number
          expected_amount: number
          id: string
          notes: string | null
          payments_count: number
          pos_contado: number | null
          pos_esperado: number
          provider: string
          settled_amount: number
          settlement_date: string
          status: string
          tenant_id: string
          total_neto: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          created_at?: string
          detalle?: Json
          diferencia_efectivo?: number | null
          diferencia_pos?: number | null
          difference?: number
          efectivo_contado?: number | null
          efectivo_esperado?: number
          expected_amount?: number
          id?: string
          notes?: string | null
          payments_count?: number
          pos_contado?: number | null
          pos_esperado?: number
          provider?: string
          settled_amount?: number
          settlement_date: string
          status?: string
          tenant_id: string
          total_neto?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          created_at?: string
          detalle?: Json
          diferencia_efectivo?: number | null
          diferencia_pos?: number | null
          difference?: number
          efectivo_contado?: number | null
          efectivo_esperado?: number
          expected_amount?: number
          id?: string
          notes?: string | null
          payments_count?: number
          pos_contado?: number | null
          pos_esperado?: number
          provider?: string
          settled_amount?: number
          settlement_date?: string
          status?: string
          tenant_id?: string
          total_neto?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_settlements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_settlements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          customer_email: string | null
          dia_negocio: string | null
          external_reference: string | null
          id: string
          idempotency_key: string | null
          intento_id: string | null
          method: string
          order_id: string | null
          pedidos: string[] | null
          provider: string
          provider_payload: Json | null
          refunded_amount: number
          session_id: string | null
          settlement_id: string | null
          staff_id: string | null
          status: string
          table_id: string | null
          tenant_id: string
          tip_amount: number
          turno_id: string | null
          updated_at: string
          user_id: string | null
          wallet: string | null
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          customer_email?: string | null
          dia_negocio?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string | null
          intento_id?: string | null
          method?: string
          order_id?: string | null
          pedidos?: string[] | null
          provider?: string
          provider_payload?: Json | null
          refunded_amount?: number
          session_id?: string | null
          settlement_id?: string | null
          staff_id?: string | null
          status?: string
          table_id?: string | null
          tenant_id: string
          tip_amount?: number
          turno_id?: string | null
          updated_at?: string
          user_id?: string | null
          wallet?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          customer_email?: string | null
          dia_negocio?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string | null
          intento_id?: string | null
          method?: string
          order_id?: string | null
          pedidos?: string[] | null
          provider?: string
          provider_payload?: Json | null
          refunded_amount?: number
          session_id?: string | null
          settlement_id?: string | null
          staff_id?: string | null
          status?: string
          table_id?: string | null
          tenant_id?: string
          tip_amount?: number
          turno_id?: string | null
          updated_at?: string
          user_id?: string | null
          wallet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "turnos"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string | null
          display_name: string
          features: Json
          id: string
          is_active: boolean | null
          max_tables: number
          name: string
        }
        Insert: {
          created_at?: string | null
          display_name: string
          features?: Json
          id?: string
          is_active?: boolean | null
          max_tables?: number
          name: string
        }
        Update: {
          created_at?: string | null
          display_name?: string
          features?: Json
          id?: string
          is_active?: boolean | null
          max_tables?: number
          name?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount: number
          authorized_by: string | null
          authorized_by_name: string | null
          authorized_role: string | null
          created_at: string
          devolucion: string | null
          dia_negocio: string | null
          external_reference: string | null
          id: string
          payment_id: string
          reason: string
          resuelto_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          amount: number
          authorized_by?: string | null
          authorized_by_name?: string | null
          authorized_role?: string | null
          created_at?: string
          devolucion?: string | null
          dia_negocio?: string | null
          external_reference?: string | null
          id?: string
          payment_id: string
          reason: string
          resuelto_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          authorized_by?: string | null
          authorized_by_name?: string | null
          authorized_role?: string | null
          created_at?: string
          devolucion?: string | null
          dia_negocio?: string | null
          external_reference?: string | null
          id?: string
          payment_id?: string
          reason?: string
          resuelto_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          created_at: string | null
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_goals: {
        Row: {
          closes_goal: number | null
          commission_per_close: number | null
          created_at: string | null
          demos_goal: number | null
          id: string
          period: string
          pilots_goal: number | null
          seller_id: string
          visits_goal: number | null
        }
        Insert: {
          closes_goal?: number | null
          commission_per_close?: number | null
          created_at?: string | null
          demos_goal?: number | null
          id?: string
          period: string
          pilots_goal?: number | null
          seller_id: string
          visits_goal?: number | null
        }
        Update: {
          closes_goal?: number | null
          commission_per_close?: number | null
          created_at?: string | null
          demos_goal?: number | null
          id?: string
          period?: string
          pilots_goal?: number | null
          seller_id?: string
          visits_goal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_goals_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "backoffice_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invitations: {
        Row: {
          branch_id: string
          created_at: string | null
          created_by: string | null
          expires_at: string
          id: string
          role: string
          tenant_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string
          id?: string
          role?: string
          tenant_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string
          id?: string
          role?: string
          tenant_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_invitations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_users: {
        Row: {
          auth_user_id: string | null
          branch_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          role: string
          tenant_id: string
        }
        Insert: {
          auth_user_id?: string | null
          branch_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          role: string
          tenant_id: string
        }
        Update: {
          auth_user_id?: string | null
          branch_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          role?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_users_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stations: {
        Row: {
          branch_id: string
          created_at: string
          es_predeterminada: boolean
          id: string
          is_active: boolean
          name: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          es_predeterminada?: boolean
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          es_predeterminada?: boolean
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_chat_uso: {
        Row: {
          dia: string
          mensajes: number
          user_id: string
        }
        Insert: {
          dia?: string
          mensajes?: number
          user_id: string
        }
        Update: {
          dia?: string
          mensajes?: number
          user_id?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          created_at: string
          id: string
          message: string
          priority: string
          status: string
          subject: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          priority?: string
          status?: string
          subject: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          priority?: string
          status?: string
          subject?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      suscripciones_push: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          tenant_id: string
          usado_at: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          tenant_id: string
          usado_at?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          tenant_id?: string
          usado_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suscripciones_push_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      table_events: {
        Row: {
          accion: string
          actor_rol: string | null
          actor_user_id: string | null
          branch_id: string
          created_at: string
          detalle: Json
          id: number
          motivo: string | null
          session_id: string | null
          table_id: string
          tenant_id: string
        }
        Insert: {
          accion: string
          actor_rol?: string | null
          actor_user_id?: string | null
          branch_id: string
          created_at?: string
          detalle?: Json
          id?: never
          motivo?: string | null
          session_id?: string | null
          table_id: string
          tenant_id: string
        }
        Update: {
          accion?: string
          actor_rol?: string | null
          actor_user_id?: string | null
          branch_id?: string
          created_at?: string
          detalle?: Json
          id?: never
          motivo?: string | null
          session_id?: string | null
          table_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_events_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_events_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      table_sessions: {
        Row: {
          branch_id: string
          closed_at: string | null
          id: string
          is_active: boolean | null
          opened_at: string | null
          paid_amount: number
          rating: number | null
          staff_id: string | null
          table_id: string
          tenant_id: string
          tip_amount: number | null
          total_amount: number | null
        }
        Insert: {
          branch_id: string
          closed_at?: string | null
          id?: string
          is_active?: boolean | null
          opened_at?: string | null
          paid_amount?: number
          rating?: number | null
          staff_id?: string | null
          table_id: string
          tenant_id: string
          tip_amount?: number | null
          total_amount?: number | null
        }
        Update: {
          branch_id?: string
          closed_at?: string | null
          id?: string
          is_active?: boolean | null
          opened_at?: string | null
          paid_amount?: number
          rating?: number | null
          staff_id?: string | null
          table_id?: string
          tenant_id?: string
          tip_amount?: number | null
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          assigned_waiter_id: string | null
          branch_id: string
          capacity: number | null
          created_at: string | null
          id: string
          name: string | null
          number: number
          position_x: number | null
          position_y: number | null
          qr_token: string
          status: string
          tenant_id: string
          unida_a: string | null
          zone: string | null
        }
        Insert: {
          assigned_waiter_id?: string | null
          branch_id: string
          capacity?: number | null
          created_at?: string | null
          id?: string
          name?: string | null
          number: number
          position_x?: number | null
          position_y?: number | null
          qr_token?: string
          status?: string
          tenant_id: string
          unida_a?: string | null
          zone?: string | null
        }
        Update: {
          assigned_waiter_id?: string | null
          branch_id?: string
          capacity?: number | null
          created_at?: string | null
          id?: string
          name?: string | null
          number?: number
          position_x?: number | null
          position_y?: number | null
          qr_token?: string
          status?: string
          tenant_id?: string
          unida_a?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tables_assigned_waiter_id_fkey"
            columns: ["assigned_waiter_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_unida_a_fkey"
            columns: ["unida_a"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_feature_flags: {
        Row: {
          flag_key: string
          is_enabled: boolean | null
          tenant_id: string
        }
        Insert: {
          flag_key: string
          is_enabled?: boolean | null
          tenant_id: string
        }
        Update: {
          flag_key?: string
          is_enabled?: boolean | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_feature_flags_flag_key_fkey"
            columns: ["flag_key"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "tenant_feature_flags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          branch_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          role?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          cover_image_url: string | null
          created_at: string | null
          email: string
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          phone: string | null
          plan_id: string | null
          plan_status: string | null
          primary_color: string | null
          rut: string | null
          secondary_color: string | null
          slug: string
          timezone: string | null
          trial_ends_at: string | null
          updated_at: string | null
          welcome_message: string | null
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string | null
          email: string
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          phone?: string | null
          plan_id?: string | null
          plan_status?: string | null
          primary_color?: string | null
          rut?: string | null
          secondary_color?: string | null
          slug: string
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          welcome_message?: string | null
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string | null
          email?: string
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          plan_id?: string | null
          plan_status?: string | null
          primary_color?: string | null
          rut?: string | null
          secondary_color?: string | null
          slug?: string
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          welcome_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      turnos: {
        Row: {
          abierto_por: string
          branch_id: string
          cerrado_por: string | null
          cerrado_por_user: string | null
          created_at: string
          fin: string | null
          id: string
          inicio: string
          nota: string | null
          staff_id: string
          tenant_id: string
        }
        Insert: {
          abierto_por?: string
          branch_id: string
          cerrado_por?: string | null
          cerrado_por_user?: string | null
          created_at?: string
          fin?: string | null
          id?: string
          inicio?: string
          nota?: string | null
          staff_id: string
          tenant_id: string
        }
        Update: {
          abierto_por?: string
          branch_id?: string
          cerrado_por?: string | null
          cerrado_por_user?: string | null
          created_at?: string
          fin?: string | null
          id?: string
          inicio?: string
          nota?: string | null
          staff_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "turnos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turnos_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turnos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      waiter_calls: {
        Row: {
          attended_at: string | null
          attended_by: string | null
          branch_id: string
          created_at: string | null
          id: string
          reason: string | null
          session_id: string | null
          status: string | null
          table_id: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          attended_at?: string | null
          attended_by?: string | null
          branch_id: string
          created_at?: string | null
          id?: string
          reason?: string | null
          session_id?: string | null
          status?: string | null
          table_id: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          attended_at?: string | null
          attended_by?: string | null
          branch_id?: string
          created_at?: string | null
          id?: string
          reason?: string | null
          session_id?: string | null
          status?: string | null
          table_id?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waiter_calls_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _anotar_token_intento: {
        Args: {
          _conexion_id: string
          _intento_id: string
          _proveedor: string
          _token: string
        }
        Returns: undefined
      }
      _anular_sellos_pago: { Args: { _payment_id: string }; Returns: undefined }
      _codigo_premio: { Args: { _tenant_id: string }; Returns: string }
      _codigo_presencia: { Args: never; Returns: string }
      _comensal_en_mesa: {
        Args: { _qr_token: string }
        Returns: Record<string, unknown>
      }
      _conciliar_dia: {
        Args: { _branch_id: string; _dia: string }
        Returns: Json
      }
      _credenciales_conexion: { Args: { _conexion_id: string }; Returns: Json }
      _desempeno_mozo: {
        Args: {
          _branch_id: string
          _desde: string
          _hasta: string
          _staff_id: string
        }
        Returns: Json
      }
      _guardar_conexion_pago: {
        Args: {
          _ambiente: string
          _branch_id: string
          _etiqueta: string
          _proveedor: string
          _secreto: Json
          _user_id: string
        }
        Returns: Json
      }
      _intento_de_retorno: {
        Args: { _orden: string; _token: string }
        Returns: Json
      }
      _mas_dias_habiles: {
        Args: { _desde: string; _dias: number }
        Returns: string
      }
      _mesa_del_qr: { Args: { _qr_token: string }; Returns: string }
      _mesa_y_actor: {
        Args: { _table_id: string }
        Returns: Record<string, unknown>
      }
      _mi_ficha: {
        Args: { _tenant_id: string }
        Returns: {
          auth_user_id: string | null
          branch_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          role: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "staff_users"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _minutos_plato: { Args: { _menu_item_id: string }; Returns: number }
      _pasarela_sucursal: { Args: { _branch_id: string }; Returns: Json }
      _presente: {
        Args: { _session_id: string; _user_id: string }
        Returns: boolean
      }
      _programa_lealtad: {
        Args: { _branch_id: string; _tenant_id: string }
        Returns: {
          branch_id: string | null
          created_at: string
          goal_visits: number
          id: string
          is_active: boolean
          monto_minimo: number
          points_goal: number
          points_per_thousand: number
          reward_description: string
          tenant_id: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "loyalty_programs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _propinas_pendientes: {
        Args: { _branch_id: string }
        Returns: {
          medio: string
          pagada_at: string
          pago_id: string
          propina: number
          staff_id: string
        }[]
      }
      _puede_configurar_pagos: {
        Args: { _branch_id: string; _user_id: string }
        Returns: boolean
      }
      _resumen_turno: { Args: { _turno_id: string }; Returns: Json }
      _sellos_pago: {
        Args: {
          _payment_id: string
          _retroactivo?: boolean
          _solo_usuario?: string
        }
        Returns: number
      }
      _sembrar_cliente_demo: { Args: never; Returns: number }
      _sembrar_historia_demo: { Args: { _dias?: number }; Returns: number }
      _sembrar_propinas_pagadas_demo: { Args: never; Returns: number }
      _tenant_caja: { Args: { _branch_id: string }; Returns: string }
      _tenant_reportes: { Args: { _branch_id: string }; Returns: string }
      _turno_abierto: { Args: { _staff_id: string }; Returns: string }
      _ventana_dias: {
        Args: { _branch_id: string; _desde: string; _hasta: string }
        Returns: Record<string, unknown>
      }
      _ventas_dias: {
        Args: { _branch_id: string; _desde: string; _hasta: string }
        Returns: {
          pagos: number
          propinas: number
          reembolsado: number
          ventas: number
        }[]
      }
      abrir_mesa: { Args: { _table_id: string }; Returns: Json }
      abrir_turno: { Args: { _branch_id: string }; Returns: Json }
      activar_personal: {
        Args: { _activo: boolean; _staff_id: string }
        Returns: undefined
      }
      actualizar_personal: {
        Args: { _nombre: string; _rol: string; _staff_id: string }
        Returns: undefined
      }
      atender_cuenta: { Args: { _id: string }; Returns: undefined }
      atender_llamado: { Args: { _id: string }; Returns: undefined }
      auditoria_operacion: {
        Args: never
        Returns: {
          detalle: string
          objeto: string
          tipo: string
        }[]
      }
      auditoria_plata: {
        Args: never
        Returns: {
          detalle: string
          objeto: string
          tipo: string
        }[]
      }
      auditoria_seguridad: {
        Args: never
        Returns: {
          detalle: string
          objeto: string
          tipo: string
        }[]
      }
      calcular_precios: {
        Args: { _branch_id: string; _items: Json; _tenant_id: string }
        Returns: Json
      }
      calificar_mesa: {
        Args: { _estrellas: number; _qr_token: string }
        Returns: undefined
      }
      cambiar_codigos_mesa: { Args: { _branch_id: string }; Returns: number }
      cambiar_estado_pedido: {
        Args: {
          _estado: string
          _motivo?: string
          _order_id: string
          _station_id?: string
        }
        Returns: Json
      }
      cancelar_llamado: { Args: { _id: string }; Returns: undefined }
      cerrar_caja: {
        Args: {
          _branch_id: string
          _dia: string
          _efectivo_contado: number
          _notas?: string
          _pos_contado?: number
        }
        Returns: Json
      }
      cerrar_mesa: {
        Args: { _motivo?: string; _table_id: string }
        Returns: Json
      }
      cerrar_turno: {
        Args: { _nota?: string; _turno_id?: string }
        Returns: Json
      }
      confirmar_pago: {
        Args: {
          _aprobado: boolean
          _correo?: string
          _intento_id: string
          _monto_cobrado: number
          _payload?: Json
          _proveedor: string
          _referencia: string
        }
        Returns: Json
      }
      confirmar_presencia: {
        Args: { _codigo: string; _qr_token: string }
        Returns: Json
      }
      confirmar_reembolso: {
        Args: { _ok: boolean; _referencia?: string; _refund_id: string }
        Returns: Json
      }
      cotizar: {
        Args: {
          _items?: Json
          _notas?: string
          _order_ids?: string[]
          _qr_token: string
        }
        Returns: Json
      }
      crear_cotizacion: {
        Args: {
          _items?: Json
          _notas?: string
          _order_ids?: string[]
          _qr_token: string
          _user_id: string
        }
        Returns: Json
      }
      crear_pedido_mozo: {
        Args: { _items: Json; _notas?: string; _table_id: string }
        Returns: Json
      }
      desconectar_pago: { Args: { _conexion_id: string }; Returns: undefined }
      dia_abierto: {
        Args: { _branch_id: string; _dia: string }
        Returns: string
      }
      dia_negocio: {
        Args: { _branch_id: string; _ts: string }
        Returns: string
      }
      entregar_premio: {
        Args: { _codigo: string; _premio_id: string }
        Returns: Json
      }
      es_backoffice: { Args: never; Returns: boolean }
      es_rol_backoffice: { Args: { _roles: string[] }; Returns: boolean }
      estado_presencia: { Args: { _qr_token: string }; Returns: Json }
      get_tenant_id: { Args: never; Returns: string }
      guardar_suscripcion_push: {
        Args: {
          _auth: string
          _endpoint: string
          _p256dh: string
          _qr_token: string
        }
        Returns: Json
      }
      has_backoffice_role: {
        Args: { _role: string; _user_id: string }
        Returns: boolean
      }
      has_staff_role: {
        Args: { _role: string; _user_id: string }
        Returns: boolean
      }
      historia_del_local: { Args: { _branch_id: string }; Returns: Json }
      is_platform_admin: { Args: never; Returns: boolean }
      is_tenant_member: { Args: { _tenant_id: string }; Returns: boolean }
      llamar_mozo: {
        Args: { _motivo?: string; _qr_token: string }
        Returns: Json
      }
      lo_de_siempre: { Args: { _qr_token: string }; Returns: Json }
      marcar_agotado: {
        Args: { _agotado: boolean; _menu_item_id: string }
        Returns: undefined
      }
      mi_desempeno: { Args: { _branch_id: string }; Returns: Json }
      mi_mesa_en_vivo: { Args: { _qr_token: string }; Returns: Json }
      mi_miembro_backoffice: { Args: never; Returns: string }
      mi_perfil: { Args: never; Returns: Json }
      mi_turno: { Args: { _branch_id: string }; Returns: Json }
      mis_propinas_por_cobrar: { Args: { _branch_id: string }; Returns: Json }
      mis_sellos: {
        Args: { _branch_id?: string; _tenant_id: string }
        Returns: Json
      }
      pagar_propinas: {
        Args: {
          _branch_id: string
          _medio: string
          _nota?: string
          _staff_id: string
        }
        Returns: Json
      }
      pasarela_de_mesa: { Args: { _qr_token: string }; Returns: Json }
      pedir_cuenta: {
        Args: { _porcentaje?: number; _propina?: number; _qr_token: string }
        Returns: Json
      }
      pedir_sin_pagar: {
        Args: {
          _forma: string
          _items: Json
          _notas?: string
          _qr_token: string
        }
        Returns: Json
      }
      premios_en_mesa: { Args: { _table_id: string }; Returns: Json }
      premios_por_entregar: { Args: { _tenant_id: string }; Returns: Json }
      propinas_por_pagar: { Args: { _branch_id: string }; Returns: Json }
      puede_asignar_rol: {
        Args: { _rol: string; _tenant_id: string }
        Returns: boolean
      }
      puede_editar_fotos: { Args: { _carpeta: string }; Returns: boolean }
      rango_estado: { Args: { _estado: string }; Returns: number }
      ranking_equipo: {
        Args: { _branch_id: string; _desde: string; _hasta: string }
        Returns: Json
      }
      registrar_acceso_soporte: {
        Args: { _id: string; _tipo: string }
        Returns: undefined
      }
      registrar_cobro_mozo: {
        Args: {
          _metodo: string
          _order_ids: string[]
          _propina?: number
          _recibido?: number
        }
        Returns: Json
      }
      registrar_uso_chat: {
        Args: { _limite: number; _user_id: string }
        Returns: boolean
      }
      reiniciar_demo: { Args: never; Returns: Json }
      reporte_local: {
        Args: { _branch_id: string; _desde: string; _hasta: string }
        Returns: Json
      }
      reservar_intento_pago: {
        Args: {
          _cotizacion_id: string
          _idempotency_key: string
          _metodo: string
          _propina?: number
          _user_id: string
        }
        Returns: Json
      }
      reservar_reembolso: {
        Args: {
          _monto: number
          _motivo: string
          _payment_id: string
          _user_id: string
        }
        Returns: Json
      }
      resultado_intento: { Args: { _intento_id: string }; Returns: Json }
      resumen_caja: {
        Args: { _branch_id: string; _dia?: string }
        Returns: Json
      }
      riesgo_cuenta_abierta: { Args: { _branch_id: string }; Returns: Json }
      sa_activar_local: {
        Args: { _activo: boolean; _tenant_id: string }
        Returns: undefined
      }
      separar_mesa: { Args: { _secundaria: string }; Returns: Json }
      siguiente_numero_pedido: { Args: { _branch_id: string }; Returns: number }
      tenants_privado: {
        Args: never
        Returns: {
          cover_image_url: string | null
          created_at: string | null
          email: string
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          phone: string | null
          plan_id: string | null
          plan_status: string | null
          primary_color: string | null
          rut: string | null
          secondary_color: string | null
          slug: string
          timezone: string | null
          trial_ends_at: string | null
          updated_at: string | null
          welcome_message: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tiene_rol: {
        Args: { _roles: string[]; _tenant_id: string }
        Returns: boolean
      }
      tomar_mesa: { Args: { _table_id: string }; Returns: Json }
      transferir_mesa: {
        Args: { _staff_id: string; _table_id: string }
        Returns: Json
      }
      turnos_sucursal: {
        Args: { _branch_id: string; _desde: string; _hasta: string }
        Returns: Json
      }
      unir_mesas: {
        Args: { _principal: string; _secundaria: string }
        Returns: Json
      }
      unirse_a_mesa: {
        Args: { _alias?: string; _qr_token: string }
        Returns: Json
      }
      ver_invitacion_mozo: {
        Args: { _token: string }
        Returns: {
          estado: string
          local: string
          rol: string
        }[]
      }
      ver_mesa: { Args: { _qr_token: string }; Returns: Json }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
