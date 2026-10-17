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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activaciones_local: {
        Row: {
          anulado_at: string | null
          branch_id: string
          correo: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          nombre_dueno: string | null
          tenant_id: string
          token: string
          usado_por: string | null
          used_at: string | null
        }
        Insert: {
          anulado_at?: string | null
          branch_id: string
          correo: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          nombre_dueno?: string | null
          tenant_id: string
          token: string
          usado_por?: string | null
          used_at?: string | null
        }
        Update: {
          anulado_at?: string | null
          branch_id?: string
          correo?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          nombre_dueno?: string | null
          tenant_id?: string
          token?: string
          usado_por?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activaciones_local_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activaciones_local_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
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
      bajas_campanas: {
        Row: {
          created_at: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bajas_campanas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      beneficios_usados: {
        Row: {
          campana_id: string | null
          created_at: string
          descuento: number
          envio_id: string | null
          id: string
          order_id: string
          payment_id: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          campana_id?: string | null
          created_at?: string
          descuento: number
          envio_id?: string | null
          id?: string
          order_id: string
          payment_id: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          campana_id?: string | null
          created_at?: string
          descuento?: number
          envio_id?: string | null
          id?: string
          order_id?: string
          payment_id?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "beneficios_usados_campana_id_fkey"
            columns: ["campana_id"]
            isOneToOne: false
            referencedRelation: "campanas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beneficios_usados_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: true
            referencedRelation: "envios_campana"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beneficios_usados_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beneficios_usados_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beneficios_usados_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      bloqueos_invitacion: {
        Row: {
          created_at: string
          de_table_id: string
          para_session_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          de_table_id: string
          para_session_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          de_table_id?: string
          para_session_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bloqueos_invitacion_de_table_id_fkey"
            columns: ["de_table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloqueos_invitacion_para_session_id_fkey"
            columns: ["para_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloqueos_invitacion_tenant_id_fkey"
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
          datos_transferencia: string | null
          id: string
          invitar_mesas: boolean
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
          primeros_pasos_ocultos_at: string | null
          qr_listos_at: string | null
          recordar_boleta: boolean
          restaurant_id: string
          tenant_id: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          corte_dia?: string
          created_at?: string | null
          datos_transferencia?: string | null
          id?: string
          invitar_mesas?: boolean
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
          primeros_pasos_ocultos_at?: string | null
          qr_listos_at?: string | null
          recordar_boleta?: boolean
          restaurant_id: string
          tenant_id: string
        }
        Update: {
          address?: string | null
          city?: string | null
          corte_dia?: string
          created_at?: string | null
          datos_transferencia?: string | null
          id?: string
          invitar_mesas?: boolean
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
          primeros_pasos_ocultos_at?: string | null
          qr_listos_at?: string | null
          recordar_boleta?: boolean
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
      campanas: {
        Row: {
          beneficio_dias: number
          beneficio_minimo: number
          beneficio_tipo: string | null
          beneficio_valor: number | null
          con_aviso: number
          creada_por: string | null
          created_at: string
          destinatarios: number
          entregados: number
          enviada_at: string | null
          enviada_por: string | null
          estado: string
          fallidos: number
          id: string
          mensaje: string
          menu_item_id: string | null
          publico: string
          tenant_id: string
          titulo: string
          updated_at: string
        }
        Insert: {
          beneficio_dias?: number
          beneficio_minimo?: number
          beneficio_tipo?: string | null
          beneficio_valor?: number | null
          con_aviso?: number
          creada_por?: string | null
          created_at?: string
          destinatarios?: number
          entregados?: number
          enviada_at?: string | null
          enviada_por?: string | null
          estado?: string
          fallidos?: number
          id?: string
          mensaje: string
          menu_item_id?: string | null
          publico: string
          tenant_id: string
          titulo: string
          updated_at?: string
        }
        Update: {
          beneficio_dias?: number
          beneficio_minimo?: number
          beneficio_tipo?: string | null
          beneficio_valor?: number | null
          con_aviso?: number
          creada_por?: string | null
          created_at?: string
          destinatarios?: number
          entregados?: number
          enviada_at?: string | null
          enviada_por?: string | null
          estado?: string
          fallidos?: number
          id?: string
          mensaje?: string
          menu_item_id?: string | null
          publico?: string
          tenant_id?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campanas_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanas_tenant_id_fkey"
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
      cobros_mensualidad: {
        Row: {
          created_at: string
          estado: string
          folio_factura: string | null
          id: string
          medio: string | null
          monto: number
          motivo_anulacion: string | null
          pagado_at: string | null
          periodo: string
          referencia: string | null
          registrado_por: string | null
          tenant_id: string
          vence_el: string
        }
        Insert: {
          created_at?: string
          estado?: string
          folio_factura?: string | null
          id?: string
          medio?: string | null
          monto: number
          motivo_anulacion?: string | null
          pagado_at?: string | null
          periodo: string
          referencia?: string | null
          registrado_por?: string | null
          tenant_id: string
          vence_el: string
        }
        Update: {
          created_at?: string
          estado?: string
          folio_factura?: string | null
          id?: string
          medio?: string | null
          monto?: number
          motivo_anulacion?: string | null
          pagado_at?: string | null
          periodo?: string
          referencia?: string | null
          registrado_por?: string | null
          tenant_id?: string
          vence_el?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobros_mensualidad_tenant_id_fkey"
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
      consentimientos_comensal: {
        Row: {
          actualizado_at: string
          politica_version: string
          promociones: boolean
          user_id: string
        }
        Insert: {
          actualizado_at?: string
          politica_version: string
          promociones?: boolean
          user_id: string
        }
        Update: {
          actualizado_at?: string
          politica_version?: string
          promociones?: boolean
          user_id?: string
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
      cortes_caja: {
        Row: {
          app_esperado: number
          branch_id: string
          created_at: string
          dia: string
          diferencia_efectivo: number
          diferencia_pos: number | null
          efectivo_contado: number
          efectivo_esperado: number
          final: boolean
          hecho_por: string | null
          hecho_por_nombre: string | null
          id: string
          nombre: string
          notas: string | null
          numero: number
          pagos: number
          pos_contado: number | null
          pos_esperado: number
          tenant_id: string
          transferencia_esperada: number
        }
        Insert: {
          app_esperado?: number
          branch_id: string
          created_at?: string
          dia: string
          diferencia_efectivo: number
          diferencia_pos?: number | null
          efectivo_contado: number
          efectivo_esperado: number
          final?: boolean
          hecho_por?: string | null
          hecho_por_nombre?: string | null
          id?: string
          nombre: string
          notas?: string | null
          numero: number
          pagos?: number
          pos_contado?: number | null
          pos_esperado: number
          tenant_id: string
          transferencia_esperada?: number
        }
        Update: {
          app_esperado?: number
          branch_id?: string
          created_at?: string
          dia?: string
          diferencia_efectivo?: number
          diferencia_pos?: number | null
          efectivo_contado?: number
          efectivo_esperado?: number
          final?: boolean
          hecho_por?: string | null
          hecho_por_nombre?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          numero?: number
          pagos?: number
          pos_contado?: number | null
          pos_esperado?: number
          tenant_id?: string
          transferencia_esperada?: number
        }
        Relationships: [
          {
            foreignKeyName: "cortes_caja_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizaciones: {
        Row: {
          branch_id: string
          created_at: string
          descuento: number
          envio_campana_id: string | null
          estado: string
          expira_at: string
          id: string
          invitacion_id: string | null
          items: Json | null
          notas: string | null
          order_ids: string[] | null
          parte_id: string | null
          ronda: boolean
          subtotal: number
          table_id: string
          tenant_id: string
          tipo: string
          user_id: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          descuento?: number
          envio_campana_id?: string | null
          estado?: string
          expira_at?: string
          id?: string
          invitacion_id?: string | null
          items?: Json | null
          notas?: string | null
          order_ids?: string[] | null
          parte_id?: string | null
          ronda?: boolean
          subtotal: number
          table_id: string
          tenant_id: string
          tipo: string
          user_id?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          descuento?: number
          envio_campana_id?: string | null
          estado?: string
          expira_at?: string
          id?: string
          invitacion_id?: string | null
          items?: Json | null
          notas?: string | null
          order_ids?: string[] | null
          parte_id?: string | null
          ronda?: boolean
          subtotal?: number
          table_id?: string
          tenant_id?: string
          tipo?: string
          user_id?: string | null
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
            foreignKeyName: "cotizaciones_envio_campana_id_fkey"
            columns: ["envio_campana_id"]
            isOneToOne: false
            referencedRelation: "envios_campana"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_invitacion_id_fkey"
            columns: ["invitacion_id"]
            isOneToOne: false
            referencedRelation: "invitaciones_mesa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_parte_id_fkey"
            columns: ["parte_id"]
            isOneToOne: false
            referencedRelation: "partes_plato"
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
      diferencias_pasarela: {
        Row: {
          actualizada_at: string
          branch_id: string
          created_at: string
          detalle: string
          dia: string
          estado: string
          id: string
          monto: number
          nota: string | null
          payment_id: string
          revisada_at: string | null
          revisada_por: string | null
          tenant_id: string
        }
        Insert: {
          actualizada_at?: string
          branch_id: string
          created_at?: string
          detalle: string
          dia: string
          estado?: string
          id?: string
          monto: number
          nota?: string | null
          payment_id: string
          revisada_at?: string | null
          revisada_por?: string | null
          tenant_id: string
        }
        Update: {
          actualizada_at?: string
          branch_id?: string
          created_at?: string
          detalle?: string
          dia?: string
          estado?: string
          id?: string
          monto?: number
          nota?: string | null
          payment_id?: string
          revisada_at?: string | null
          revisada_por?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "diferencias_pasarela_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diferencias_pasarela_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diferencias_pasarela_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      envios_campana: {
        Row: {
          abierto_at: string | null
          campana_id: string
          created_at: string
          enviado_at: string | null
          estado: string
          id: string
          tenant_id: string
          token: string
          user_id: string | null
        }
        Insert: {
          abierto_at?: string | null
          campana_id: string
          created_at?: string
          enviado_at?: string | null
          estado?: string
          id?: string
          tenant_id: string
          token?: string
          user_id?: string | null
        }
        Update: {
          abierto_at?: string | null
          campana_id?: string
          created_at?: string
          enviado_at?: string | null
          estado?: string
          id?: string
          tenant_id?: string
          token?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "envios_campana_campana_id_fkey"
            columns: ["campana_id"]
            isOneToOne: false
            referencedRelation: "campanas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_campana_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      equipos_compartidos: {
        Row: {
          branch_id: string
          creado_por: string | null
          created_at: string
          id: string
          nombre: string
          revocado_at: string | null
          tenant_id: string
          token_hash: string
          ultimo_uso_at: string | null
        }
        Insert: {
          branch_id: string
          creado_por?: string | null
          created_at?: string
          id?: string
          nombre: string
          revocado_at?: string | null
          tenant_id: string
          token_hash: string
          ultimo_uso_at?: string | null
        }
        Update: {
          branch_id?: string
          creado_por?: string | null
          created_at?: string
          id?: string
          nombre?: string
          revocado_at?: string | null
          tenant_id?: string
          token_hash?: string
          ultimo_uso_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipos_compartidos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipos_compartidos_tenant_id_fkey"
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
          devolucion_at: string | null
          devolucion_estado: string | null
          devolucion_intentos: number
          devolucion_nota: string | null
          devolucion_referencia: string | null
          devolucion_resuelta_por: string | null
          estado: string
          id: string
          idempotency_key: string
          metodo: string
          monto: number
          monto_devolver: number | null
          motivo: string | null
          payment_id: string | null
          propina: number
          proveedor: string | null
          referencia_externa: string | null
          resuelto_at: string | null
          tenant_id: string
          token_externo: string | null
          user_id: string | null
        }
        Insert: {
          conexion_id?: string | null
          cotizacion_id: string
          created_at?: string
          devolucion_at?: string | null
          devolucion_estado?: string | null
          devolucion_intentos?: number
          devolucion_nota?: string | null
          devolucion_referencia?: string | null
          devolucion_resuelta_por?: string | null
          estado?: string
          id?: string
          idempotency_key: string
          metodo: string
          monto: number
          monto_devolver?: number | null
          motivo?: string | null
          payment_id?: string | null
          propina?: number
          proveedor?: string | null
          referencia_externa?: string | null
          resuelto_at?: string | null
          tenant_id: string
          token_externo?: string | null
          user_id?: string | null
        }
        Update: {
          conexion_id?: string | null
          cotizacion_id?: string
          created_at?: string
          devolucion_at?: string | null
          devolucion_estado?: string | null
          devolucion_intentos?: number
          devolucion_nota?: string | null
          devolucion_referencia?: string | null
          devolucion_resuelta_por?: string | null
          estado?: string
          id?: string
          idempotency_key?: string
          metodo?: string
          monto?: number
          monto_devolver?: number | null
          motivo?: string | null
          payment_id?: string | null
          propina?: number
          proveedor?: string | null
          referencia_externa?: string | null
          resuelto_at?: string | null
          tenant_id?: string
          token_externo?: string | null
          user_id?: string | null
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
      invitaciones_mesa: {
        Row: {
          branch_id: string
          created_at: string
          de_alias: string | null
          de_session_id: string
          de_table_id: string
          de_user_id: string | null
          estado: string
          id: string
          mensaje: string | null
          menu_item_id: string
          order_id: string | null
          pagada_at: string | null
          para_session_id: string
          para_table_id: string
          payment_id: string | null
          respondida_at: string | null
          respondida_por: string | null
          tenant_id: string
          vence_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          de_alias?: string | null
          de_session_id: string
          de_table_id: string
          de_user_id?: string | null
          estado?: string
          id?: string
          mensaje?: string | null
          menu_item_id: string
          order_id?: string | null
          pagada_at?: string | null
          para_session_id: string
          para_table_id: string
          payment_id?: string | null
          respondida_at?: string | null
          respondida_por?: string | null
          tenant_id: string
          vence_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          de_alias?: string | null
          de_session_id?: string
          de_table_id?: string
          de_user_id?: string | null
          estado?: string
          id?: string
          mensaje?: string | null
          menu_item_id?: string
          order_id?: string | null
          pagada_at?: string | null
          para_session_id?: string
          para_table_id?: string
          payment_id?: string | null
          respondida_at?: string | null
          respondida_por?: string | null
          tenant_id?: string
          vence_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitaciones_mesa_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitaciones_mesa_de_session_id_fkey"
            columns: ["de_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitaciones_mesa_de_table_id_fkey"
            columns: ["de_table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitaciones_mesa_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitaciones_mesa_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitaciones_mesa_para_session_id_fkey"
            columns: ["para_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitaciones_mesa_para_table_id_fkey"
            columns: ["para_table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitaciones_mesa_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitaciones_mesa_tenant_id_fkey"
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
          nivel_oro: number
          nivel_plata: number
          niveles_activos: boolean
          pasaporte_activo: boolean
          points_goal: number
          points_per_thousand: number
          premio_oro: string | null
          premio_plata: string | null
          racha_dia: number | null
          racha_premio: string | null
          racha_semanas: number | null
          reward_description: string
          sorpresa_activa: boolean
          sorpresa_monto_minimo: number
          sorpresa_premio: string | null
          sorpresa_tope_mes: number
          sorpresa_uno_de: number
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
          nivel_oro?: number
          nivel_plata?: number
          niveles_activos?: boolean
          pasaporte_activo?: boolean
          points_goal?: number
          points_per_thousand?: number
          premio_oro?: string | null
          premio_plata?: string | null
          racha_dia?: number | null
          racha_premio?: string | null
          racha_semanas?: number | null
          reward_description?: string
          sorpresa_activa?: boolean
          sorpresa_monto_minimo?: number
          sorpresa_premio?: string | null
          sorpresa_tope_mes?: number
          sorpresa_uno_de?: number
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
          nivel_oro?: number
          nivel_plata?: number
          niveles_activos?: boolean
          pasaporte_activo?: boolean
          points_goal?: number
          points_per_thousand?: number
          premio_oro?: string | null
          premio_plata?: string | null
          racha_dia?: number | null
          racha_premio?: string | null
          racha_semanas?: number | null
          reward_description?: string
          sorpresa_activa?: boolean
          sorpresa_monto_minimo?: number
          sorpresa_premio?: string | null
          sorpresa_tope_mes?: number
          sorpresa_uno_de?: number
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
          logro: string | null
          motivo: string
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
          logro?: string | null
          motivo?: string
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
          logro?: string | null
          motivo?: string
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
          tiene_alcohol: boolean
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
          tiene_alcohol?: boolean
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
          tiene_alcohol?: boolean
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
          descuento: number
          envio_campana_id: string | null
          forma_pago: string | null
          id: string
          kitchen_accepted_at: string | null
          notes: string | null
          order_number: number
          paid_at: string | null
          payment_status: string
          perdido_at: string | null
          ready_at: string | null
          ronda: boolean
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
          descuento?: number
          envio_campana_id?: string | null
          forma_pago?: string | null
          id?: string
          kitchen_accepted_at?: string | null
          notes?: string | null
          order_number: number
          paid_at?: string | null
          payment_status?: string
          perdido_at?: string | null
          ready_at?: string | null
          ronda?: boolean
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
          descuento?: number
          envio_campana_id?: string | null
          forma_pago?: string | null
          id?: string
          kitchen_accepted_at?: string | null
          notes?: string | null
          order_number?: number
          paid_at?: string | null
          payment_status?: string
          perdido_at?: string | null
          ready_at?: string | null
          ronda?: boolean
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
            foreignKeyName: "orders_envio_campana_id_fkey"
            columns: ["envio_campana_id"]
            isOneToOne: false
            referencedRelation: "envios_campana"
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
      partes_plato: {
        Row: {
          comensal_id: string | null
          created_at: string
          estado: string
          id: string
          monto: number
          pagada_at: string | null
          payment_id: string | null
          plato_id: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          comensal_id?: string | null
          created_at?: string
          estado?: string
          id?: string
          monto: number
          pagada_at?: string | null
          payment_id?: string | null
          plato_id: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          comensal_id?: string | null
          created_at?: string
          estado?: string
          id?: string
          monto?: number
          pagada_at?: string | null
          payment_id?: string | null
          plato_id?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partes_plato_comensal_id_fkey"
            columns: ["comensal_id"]
            isOneToOne: false
            referencedRelation: "comensales_mesa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partes_plato_pago_fk"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partes_plato_plato_id_fkey"
            columns: ["plato_id"]
            isOneToOne: false
            referencedRelation: "platos_divididos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partes_plato_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      partidas_trivia: {
        Row: {
          created_at: string
          id: string
          preguntas: string[]
          puntaje: number | null
          session_id: string
          tenant_id: string
          terminada_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          preguntas: string[]
          puntaje?: number | null
          session_id: string
          tenant_id: string
          terminada_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          preguntas?: string[]
          puntaje?: number | null
          session_id?: string
          tenant_id?: string
          terminada_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partidas_trivia_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partidas_trivia_tenant_id_fkey"
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
          boleta_estado: string | null
          boleta_folio: string | null
          boleta_marcada_at: string | null
          boleta_marcada_por: string | null
          boleta_nota: string | null
          branch_id: string
          corte_numero: number | null
          created_at: string
          customer_email: string | null
          dia_negocio: string | null
          external_reference: string | null
          id: string
          idempotency_key: string | null
          intento_id: string | null
          method: string
          order_id: string | null
          parte_id: string | null
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
          boleta_estado?: string | null
          boleta_folio?: string | null
          boleta_marcada_at?: string | null
          boleta_marcada_por?: string | null
          boleta_nota?: string | null
          branch_id: string
          corte_numero?: number | null
          created_at?: string
          customer_email?: string | null
          dia_negocio?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string | null
          intento_id?: string | null
          method?: string
          order_id?: string | null
          parte_id?: string | null
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
          boleta_estado?: string | null
          boleta_folio?: string | null
          boleta_marcada_at?: string | null
          boleta_marcada_por?: string | null
          boleta_nota?: string | null
          branch_id?: string
          corte_numero?: number | null
          created_at?: string
          customer_email?: string | null
          dia_negocio?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string | null
          intento_id?: string | null
          method?: string
          order_id?: string | null
          parte_id?: string | null
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
            foreignKeyName: "payments_parte_id_fkey"
            columns: ["parte_id"]
            isOneToOne: false
            referencedRelation: "partes_plato"
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
      permisos_rol: {
        Row: {
          actualizado_por: string | null
          permiso: string
          permitido: boolean
          rol: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actualizado_por?: string | null
          permiso: string
          permitido: boolean
          rol: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actualizado_por?: string | null
          permiso?: string
          permitido?: boolean
          rol?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "permisos_rol_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pines_personal: {
        Row: {
          actualizado_at: string
          bloqueado_hasta: string | null
          intentos: number
          pin_hash: string
          staff_id: string
          tenant_id: string
        }
        Insert: {
          actualizado_at?: string
          bloqueado_hasta?: string | null
          intentos?: number
          pin_hash: string
          staff_id: string
          tenant_id: string
        }
        Update: {
          actualizado_at?: string
          bloqueado_hasta?: string | null
          intentos?: number
          pin_hash?: string
          staff_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pines_personal_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pines_personal_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          precio_mensual: number | null
        }
        Insert: {
          created_at?: string | null
          display_name: string
          features?: Json
          id?: string
          is_active?: boolean | null
          max_tables?: number
          name: string
          precio_mensual?: number | null
        }
        Update: {
          created_at?: string | null
          display_name?: string
          features?: Json
          id?: string
          is_active?: boolean | null
          max_tables?: number
          name?: string
          precio_mensual?: number | null
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
      platos_divididos: {
        Row: {
          creado_por: string | null
          created_at: string
          estado: string
          id: string
          order_id: string
          resuelto_at: string | null
          session_id: string
          tenant_id: string
          total: number
        }
        Insert: {
          creado_por?: string | null
          created_at?: string
          estado?: string
          id?: string
          order_id: string
          resuelto_at?: string | null
          session_id: string
          tenant_id: string
          total: number
        }
        Update: {
          creado_por?: string | null
          created_at?: string
          estado?: string
          id?: string
          order_id?: string
          resuelto_at?: string | null
          session_id?: string
          tenant_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "platos_divididos_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platos_divididos_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platos_divididos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      preguntas_trivia: {
        Row: {
          activa: boolean
          correcta: number
          id: string
          opciones: string[]
          pregunta: string
          tema: string
        }
        Insert: {
          activa?: boolean
          correcta: number
          id?: string
          opciones: string[]
          pregunta: string
          tema: string
        }
        Update: {
          activa?: boolean
          correcta?: number
          id?: string
          opciones?: string[]
          pregunta?: string
          tema?: string
        }
        Relationships: []
      }
      raspes: {
        Row: {
          anulado_at: string | null
          branch_id: string | null
          created_at: string
          customer_id: string
          dia_negocio: string
          gano: boolean
          id: string
          mes: string
          movimiento_id: string
          payment_id: string
          premio: string | null
          premio_id: string | null
          raspado_at: string | null
          tenant_id: string
          tope: number
          user_id: string | null
        }
        Insert: {
          anulado_at?: string | null
          branch_id?: string | null
          created_at?: string
          customer_id: string
          dia_negocio: string
          gano: boolean
          id?: string
          mes: string
          movimiento_id: string
          payment_id: string
          premio?: string | null
          premio_id?: string | null
          raspado_at?: string | null
          tenant_id: string
          tope: number
          user_id?: string | null
        }
        Update: {
          anulado_at?: string | null
          branch_id?: string | null
          created_at?: string
          customer_id?: string
          dia_negocio?: string
          gano?: boolean
          id?: string
          mes?: string
          movimiento_id?: string
          payment_id?: string
          premio?: string | null
          premio_id?: string | null
          raspado_at?: string | null
          tenant_id?: string
          tope?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raspes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raspes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "loyalty_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raspes_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos_lealtad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raspes_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raspes_premio_id_fkey"
            columns: ["premio_id"]
            isOneToOne: false
            referencedRelation: "loyalty_rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raspes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount: number
          authorized_by: string | null
          authorized_by_name: string | null
          authorized_role: string | null
          corte_numero: number | null
          created_at: string
          devolucion: string | null
          dia_negocio: string | null
          external_reference: string | null
          id: string
          payment_id: string
          reason: string
          resuelto_at: string | null
          revisado_at: string | null
          revisado_nota: string | null
          revisado_por: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          amount: number
          authorized_by?: string | null
          authorized_by_name?: string | null
          authorized_role?: string | null
          corte_numero?: number | null
          created_at?: string
          devolucion?: string | null
          dia_negocio?: string | null
          external_reference?: string | null
          id?: string
          payment_id: string
          reason: string
          resuelto_at?: string | null
          revisado_at?: string | null
          revisado_nota?: string | null
          revisado_por?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          authorized_by?: string | null
          authorized_by_name?: string | null
          authorized_role?: string | null
          corte_numero?: number | null
          created_at?: string
          devolucion?: string | null
          dia_negocio?: string | null
          external_reference?: string | null
          id?: string
          payment_id?: string
          reason?: string
          resuelto_at?: string | null
          revisado_at?: string | null
          revisado_nota?: string | null
          revisado_por?: string | null
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
      respuestas_trivia_vivo: {
        Row: {
          alias: string
          correcta: boolean
          created_at: string
          id: string
          mesa: number | null
          numero: number
          opcion: number
          puntos: number
          tenant_id: string
          trivia_id: string
          user_id: string
        }
        Insert: {
          alias: string
          correcta: boolean
          created_at?: string
          id?: string
          mesa?: number | null
          numero: number
          opcion: number
          puntos: number
          tenant_id: string
          trivia_id: string
          user_id: string
        }
        Update: {
          alias?: string
          correcta?: boolean
          created_at?: string
          id?: string
          mesa?: number | null
          numero?: number
          opcion?: number
          puntos?: number
          tenant_id?: string
          trivia_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "respuestas_trivia_vivo_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respuestas_trivia_vivo_trivia_id_fkey"
            columns: ["trivia_id"]
            isOneToOne: false
            referencedRelation: "trivias_vivo"
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
      ruletas_mesa: {
        Row: {
          created_at: string
          elegido_alias: string | null
          elegido_id: string | null
          giro_user_id: string | null
          id: string
          session_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          elegido_alias?: string | null
          elegido_id?: string | null
          giro_user_id?: string | null
          id?: string
          session_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          elegido_alias?: string | null
          elegido_id?: string | null
          giro_user_id?: string | null
          id?: string
          session_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ruletas_mesa_elegido_id_fkey"
            columns: ["elegido_id"]
            isOneToOne: false
            referencedRelation: "comensales_mesa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ruletas_mesa_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ruletas_mesa_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      salud_registros: {
        Row: {
          created_at: string
          detalle: Json
          estado: string
          id: number
        }
        Insert: {
          created_at?: string
          detalle: Json
          estado: string
          id?: never
        }
        Update: {
          created_at?: string
          detalle?: Json
          estado?: string
          id?: never
        }
        Relationships: []
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
      suscripciones_local: {
        Row: {
          cancelada_at: string | null
          created_at: string
          desde: string
          dia_cobro: number
          dias_gracia: number
          dias_para_pagar: number
          notas: string | null
          plan_id: string | null
          precio_mensual: number
          prueba_hasta: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cancelada_at?: string | null
          created_at?: string
          desde?: string
          dia_cobro?: number
          dias_gracia?: number
          dias_para_pagar?: number
          notas?: string | null
          plan_id?: string | null
          precio_mensual: number
          prueba_hasta?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cancelada_at?: string | null
          created_at?: string
          desde?: string
          dia_cobro?: number
          dias_gracia?: number
          dias_para_pagar?: number
          notas?: string | null
          plan_id?: string | null
          precio_mensual?: number
          prueba_hasta?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suscripciones_local_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suscripciones_local_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
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
      trivias_vivo: {
        Row: {
          actual: number
          branch_id: string
          creada_por: string | null
          created_at: string
          estado: string
          id: string
          pregunta_desde: string | null
          preguntas: string[]
          segundos: number
          tenant_id: string
          terminada_at: string | null
        }
        Insert: {
          actual?: number
          branch_id: string
          creada_por?: string | null
          created_at?: string
          estado?: string
          id?: string
          pregunta_desde?: string | null
          preguntas: string[]
          segundos?: number
          tenant_id: string
          terminada_at?: string | null
        }
        Update: {
          actual?: number
          branch_id?: string
          creada_por?: string | null
          created_at?: string
          estado?: string
          id?: string
          pregunta_desde?: string | null
          preguntas?: string[]
          segundos?: number
          tenant_id?: string
          terminada_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trivias_vivo_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trivias_vivo_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      _anotar_aviso_campana: {
        Args: { _envio_id: string; _llego: boolean }
        Returns: undefined
      }
      _anotar_conciliacion: {
        Args: { _branch_id: string; _dia: string; _resultados: Json }
        Returns: number
      }
      _anotar_devolucion_intento: {
        Args: { _intento_id: string; _ok: boolean; _referencia?: string }
        Returns: undefined
      }
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
      _avisos_por_mandar: {
        Args: { _campana_id: string }
        Returns: {
          auth: string
          endpoint: string
          envio_id: string
          p256dh: string
          suscripcion_id: string
          token: string
        }[]
      }
      _beneficio_para: {
        Args: { _lineas: Json; _tenant_id: string; _user_id: string }
        Returns: {
          descuento: number
          envio_id: string
          titulo: string
        }[]
      }
      _borrar_datos_comensal: { Args: { _user_id: string }; Returns: Json }
      _catalogo_modulos: {
        Args: never
        Returns: {
          descripcion: string
          modulo: string
          nombre: string
          orden: number
        }[]
      }
      _catalogo_permisos: {
        Args: never
        Returns: {
          accion: string
          descripcion: string
          nombre: string
          orden: number
          permiso: string
          por_defecto: string[]
          posibles: string[]
        }[]
      }
      _chequeo_salud: { Args: never; Returns: Json }
      _codigo_premio: { Args: { _tenant_id: string }; Returns: string }
      _codigo_presencia: { Args: never; Returns: string }
      _comensal_en_mesa: {
        Args: { _qr_token: string }
        Returns: Record<string, unknown>
      }
      _completar_activacion: {
        Args: { _id: string; _user_id: string }
        Returns: undefined
      }
      _conciliar_dia: {
        Args: { _branch_id: string; _dia: string }
        Returns: Json
      }
      _conciliar_tramo: {
        Args: { _branch_id: string; _dia: string; _numero: number }
        Returns: Json
      }
      _credenciales_conexion: { Args: { _conexion_id: string }; Returns: Json }
      _descansando: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      _desempeno_mozo: {
        Args: {
          _branch_id: string
          _desde: string
          _hasta: string
          _staff_id: string
        }
        Returns: Json
      }
      _destinatarios_campana: {
        Args: { _plato: string; _publico: string; _tenant_id: string }
        Returns: {
          user_id: string
        }[]
      }
      _devoluciones_por_reintentar: {
        Args: { _branch_id?: string }
        Returns: {
          conexion_id: string
          id: string
          monto: number
          token: string
        }[]
      }
      _es_finanzas: { Args: never; Returns: boolean }
      _estado_mensualidad: { Args: { _tenant_id: string }; Returns: Json }
      _estado_trivia_vivo: {
        Args: { _trivia_id: string; _user_id?: string }
        Returns: Json
      }
      _exigir_encargado_trivia: {
        Args: { _tenant_id: string }
        Returns: undefined
      }
      _exigir_funcion: {
        Args: { _modulo: string; _tenant_id: string }
        Returns: undefined
      }
      _exigir_permiso: {
        Args: { _permiso: string; _tenant_id: string }
        Returns: undefined
      }
      _generar_cobros: { Args: { _hoy?: string }; Returns: number }
      _gestiona_sucursal: { Args: { _branch_id: string }; Returns: string }
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
      _intentos_por_revisar: {
        Args: { _branch_id?: string }
        Returns: {
          conexion_id: string
          id: string
          propina: number
          proveedor: string
          token: string
        }[]
      }
      _invitar_activo: { Args: { _branch_id: string }; Returns: boolean }
      _liberar_activacion: { Args: { _id: string }; Returns: undefined }
      _llamar_revisar_pagos: { Args: never; Returns: undefined }
      _logros_visita: { Args: { _movimiento_id: string }; Returns: number }
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
      _nivel_y_racha: {
        Args: {
          _customer_id: string
          _dia: string
          _prog: Database["public"]["Tables"]["loyalty_programs"]["Row"]
        }
        Returns: Json
      }
      _nuevo_enlace_activacion: {
        Args: {
          _branch_id: string
          _correo: string
          _nombre: string
          _tenant_id: string
        }
        Returns: string
      }
      _pagos_pasarela_dia: {
        Args: { _branch_id: string; _dia: string }
        Returns: {
          conexion_id: string
          created_at: string
          estado: string
          id: string
          monto: number
          propina: number
          proveedor: string
          reembolsado: number
          referencia: string
          token: string
        }[]
      }
      _pasarela_sucursal: { Args: { _branch_id: string }; Returns: Json }
      _permiso_posible: {
        Args: { _permiso: string; _rol: string }
        Returns: boolean
      }
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
          nivel_oro: number
          nivel_plata: number
          niveles_activos: boolean
          pasaporte_activo: boolean
          points_goal: number
          points_per_thousand: number
          premio_oro: string | null
          premio_plata: string | null
          racha_dia: number | null
          racha_premio: string | null
          racha_semanas: number | null
          reward_description: string
          sorpresa_activa: boolean
          sorpresa_monto_minimo: number
          sorpresa_premio: string | null
          sorpresa_tope_mes: number
          sorpresa_uno_de: number
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
      _puede_dar_alta: { Args: never; Returns: boolean }
      _puede_ver_plata: {
        Args: { _branch_id: string; _user_id: string }
        Returns: boolean
      }
      _purgar_claves_pasarela: { Args: never; Returns: number }
      _purgar_invitados: { Args: never; Returns: number }
      _raspe_visita: { Args: { _movimiento_id: string }; Returns: boolean }
      _registrar_corte: {
        Args: {
          _branch_id: string
          _dia: string
          _efectivo: number
          _final: boolean
          _local: string
          _nombre: string
          _notas: string
          _pos: number
        }
        Returns: Json
      }
      _reglas_campanas: { Args: never; Returns: Json }
      _reservar_activacion: {
        Args: { _token: string }
        Returns: {
          branch_id: string
          correo: string
          id: string
          nombre_dueno: string
          slug: string
          tenant_id: string
        }[]
      }
      _resumen_turno: { Args: { _turno_id: string }; Returns: Json }
      _revisar_salud: { Args: never; Returns: string }
      _revisar_texto_campana: { Args: { _texto: string }; Returns: undefined }
      _rol_puede: {
        Args: { _permiso: string; _rol: string; _tenant_id: string }
        Returns: boolean
      }
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
      _tramo_abierto: {
        Args: { _branch_id: string; _dia: string }
        Returns: number
      }
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
      _verificar_cron: { Args: { _clave: string }; Returns: boolean }
      _verificar_pin: {
        Args: { _pin: string; _staff_id: string; _token: string }
        Returns: Json
      }
      _version_politica: { Args: never; Returns: string }
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
      ajustar_modulo_local: {
        Args: {
          _estado: boolean
          _modulo: string
          _motivo: string
          _tenant_id: string
        }
        Returns: undefined
      }
      anular_cobro_mensualidad: {
        Args: { _cobro_id: string; _motivo: string }
        Returns: undefined
      }
      asignar_plan: {
        Args: { _plan_id: string; _tenant_id: string }
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
      avanzar_trivia_vivo: { Args: { _trivia_id: string }; Returns: Json }
      baja_promo: { Args: { _token: string }; Returns: boolean }
      boletas_pendientes: { Args: { _branch_id: string }; Returns: Json }
      borrar_campana: { Args: { _campana_id: string }; Returns: undefined }
      borrar_pin: { Args: { _staff_id: string }; Returns: undefined }
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
      cancelar_invitacion: {
        Args: { _invitacion_id: string; _qr_token: string }
        Returns: undefined
      }
      cancelar_llamado: { Args: { _id: string }; Returns: undefined }
      cancelar_suscripcion: {
        Args: { _motivo: string; _tenant_id: string }
        Returns: undefined
      }
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
          _ronda?: boolean
        }
        Returns: Json
      }
      cotizar_invitacion: {
        Args: { _invitacion_id: string; _qr_token: string }
        Returns: Json
      }
      cotizar_parte: {
        Args: { _parte_id: string; _qr_token: string }
        Returns: Json
      }
      crear_cotizacion: {
        Args: {
          _items?: Json
          _notas?: string
          _order_ids?: string[]
          _qr_token: string
          _ronda?: boolean
          _user_id: string
        }
        Returns: Json
      }
      crear_equipo_compartido: {
        Args: { _branch_id: string; _nombre: string }
        Returns: Json
      }
      crear_local: {
        Args: {
          _color?: string
          _correo_dueno: string
          _lead_id?: string
          _mesas?: number
          _modo?: string
          _nombre: string
          _nombre_dueno?: string
          _slug: string
          _telefono?: string
        }
        Returns: Json
      }
      crear_pedido_mozo: {
        Args: { _items: Json; _notas?: string; _table_id: string }
        Returns: Json
      }
      crear_trivia_vivo: {
        Args: { _branch_id: string; _preguntas?: number; _segundos?: number }
        Returns: string
      }
      definir_mi_pin: { Args: { _pin: string }; Returns: undefined }
      desconectar_pago: { Args: { _conexion_id: string }; Returns: undefined }
      dia_abierto: {
        Args: { _branch_id: string; _dia: string }
        Returns: string
      }
      dia_negocio: {
        Args: { _branch_id: string; _ts: string }
        Returns: string
      }
      dividir_plato: {
        Args: { _comensales: string[]; _item: Json; _qr_token: string }
        Returns: Json
      }
      empezar_trivia: { Args: { _qr_token: string }; Returns: Json }
      entregar_premio: {
        Args: { _codigo: string; _premio_id: string }
        Returns: Json
      }
      enviar_campana: { Args: { _campana_id: string }; Returns: Json }
      equipo_de_tablet: { Args: { _token: string }; Returns: Json }
      es_backoffice: { Args: never; Returns: boolean }
      es_rol_backoffice: { Args: { _roles: string[] }; Returns: boolean }
      estado_activaciones: {
        Args: never
        Returns: {
          activado_at: string
          correo: string
          creado_at: string
          tenant_id: string
          vence_at: string
        }[]
      }
      estado_pines: {
        Args: { _branch_id: string }
        Returns: {
          bloqueado: boolean
          staff_id: string
          tiene_pin: boolean
        }[]
      }
      estado_presencia: { Args: { _qr_token: string }; Returns: Json }
      estado_salud: { Args: never; Returns: Json }
      excepciones_caja: { Args: { _branch_id: string }; Returns: Json }
      generar_cobros_mes: { Args: never; Returns: number }
      get_tenant_id: { Args: never; Returns: string }
      girar_ruleta: { Args: { _qr_token: string }; Returns: Json }
      guardar_campana: {
        Args: {
          _beneficio_dias?: number
          _beneficio_minimo?: number
          _beneficio_tipo?: string
          _beneficio_valor?: number
          _campana_id?: string
          _mensaje: string
          _plato?: string
          _publico: string
          _tenant_id: string
          _titulo: string
        }
        Returns: string
      }
      guardar_consentimiento: { Args: { _promociones: boolean }; Returns: Json }
      guardar_modulos_plan: {
        Args: { _modulos: Json; _plan_id: string }
        Returns: undefined
      }
      guardar_permiso_rol: {
        Args: {
          _permiso: string
          _permitido: boolean
          _rol: string
          _tenant_id: string
        }
        Returns: Json
      }
      guardar_suscripcion: {
        Args: {
          _dia_cobro?: number
          _notas?: string
          _plan_id: string
          _precio_mensual: number
          _prueba_hasta?: string
          _tenant_id: string
        }
        Returns: undefined
      }
      guardar_suscripcion_push: {
        Args: {
          _auth: string
          _endpoint: string
          _p256dh: string
          _qr_token: string
        }
        Returns: Json
      }
      hacer_corte_caja: {
        Args: {
          _branch_id: string
          _efectivo_contado: number
          _nombre?: string
          _notas?: string
          _pos_contado?: number
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
      importar_carta: {
        Args: { _branch_id: string; _lineas: Json }
        Returns: Json
      }
      invitar_otra_mesa: {
        Args: {
          _mensaje?: string
          _menu_item_id: string
          _mesa: number
          _qr_token: string
        }
        Returns: string
      }
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
      marcar_boleta: {
        Args: { _folio?: string; _pago_id: string }
        Returns: Json
      }
      marcar_paso: {
        Args: { _branch_id: string; _paso: string }
        Returns: undefined
      }
      mensualidades_locales: {
        Args: never
        Returns: {
          estado: Json
          local: string
          tenant_id: string
        }[]
      }
      mesas_para_invitar: { Args: { _qr_token: string }; Returns: Json }
      metricas_finanzas: { Args: { _meses?: number }; Returns: Json }
      mi_desempeno: { Args: { _branch_id: string }; Returns: Json }
      mi_mensualidad: { Args: { _tenant_id: string }; Returns: Json }
      mi_mesa_en_vivo: { Args: { _qr_token: string }; Returns: Json }
      mi_miembro_backoffice: { Args: never; Returns: string }
      mi_pasaporte: { Args: { _tenant_id: string }; Returns: Json }
      mi_perfil: { Args: never; Returns: Json }
      mi_turno: { Args: { _branch_id: string }; Returns: Json }
      mis_boletas_pendientes: { Args: never; Returns: Json }
      mis_datos: { Args: never; Returns: Json }
      mis_propinas_por_cobrar: { Args: { _branch_id: string }; Returns: Json }
      mis_raspes: { Args: { _tenant_id: string }; Returns: Json }
      mis_sellos: {
        Args: { _branch_id?: string; _tenant_id: string }
        Returns: Json
      }
      modulos_del_local: { Args: { _tenant_id: string }; Returns: Json }
      nuevo_enlace_activacion: { Args: { _tenant_id: string }; Returns: Json }
      pagar_propinas: {
        Args: {
          _branch_id: string
          _medio: string
          _nota?: string
          _staff_id: string
        }
        Returns: Json
      }
      pantalla_trivia_vivo: { Args: { _branch_id: string }; Returns: Json }
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
      permisos_del_local: { Args: { _tenant_id: string }; Returns: Json }
      premios_en_mesa: { Args: { _table_id: string }; Returns: Json }
      premios_por_entregar: { Args: { _tenant_id: string }; Returns: Json }
      primeros_pasos: { Args: { _branch_id: string }; Returns: Json }
      propinas_por_pagar: { Args: { _branch_id: string }; Returns: Json }
      publico_campana: {
        Args: { _plato?: string; _publico: string; _tenant_id: string }
        Returns: Json
      }
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
      raspar: { Args: { _raspe_id: string }; Returns: Json }
      rechazar_parte: {
        Args: { _parte_id: string; _qr_token: string }
        Returns: undefined
      }
      registrar_acceso_soporte: {
        Args: { _id: string; _tipo: string }
        Returns: undefined
      }
      registrar_cobro_mozo: {
        Args: {
          _boleta_entregada?: boolean
          _boleta_folio?: string
          _metodo: string
          _order_ids: string[]
          _propina?: number
          _recibido?: number
        }
        Returns: Json
      }
      registrar_pago_mensualidad: {
        Args: {
          _cobro_id: string
          _folio?: string
          _medio: string
          _referencia?: string
        }
        Returns: undefined
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
      resolver_excepcion: {
        Args: {
          _accion: string
          _folio?: string
          _id: string
          _nota?: string
          _tipo: string
        }
        Returns: Json
      }
      responder_invitacion: {
        Args: {
          _aceptar: boolean
          _bloquear?: boolean
          _invitacion_id: string
          _qr_token: string
        }
        Returns: undefined
      }
      responder_trivia: {
        Args: { _partida: string; _qr_token: string; _respuestas: number[] }
        Returns: Json
      }
      responder_trivia_vivo: {
        Args: {
          _numero: number
          _opcion: number
          _qr_token: string
          _trivia_id: string
        }
        Returns: Json
      }
      resultado_intento: { Args: { _intento_id: string }; Returns: Json }
      resultados_campanas: { Args: { _tenant_id: string }; Returns: Json }
      resumen_caja: {
        Args: { _branch_id: string; _dia?: string }
        Returns: Json
      }
      revocar_equipo_compartido: { Args: { _id: string }; Returns: undefined }
      riesgo_cuenta_abierta: { Args: { _branch_id: string }; Returns: Json }
      sa_activar_local: {
        Args: { _activo: boolean; _tenant_id: string }
        Returns: undefined
      }
      salud_plataforma: { Args: never; Returns: Json }
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
      terminar_trivia_vivo: { Args: { _trivia_id: string }; Returns: undefined }
      tiene_funcion: {
        Args: { _modulo: string; _tenant_id: string }
        Returns: boolean
      }
      tiene_permiso: {
        Args: { _permiso: string; _tenant_id: string }
        Returns: boolean
      }
      tiene_rol: {
        Args: { _roles: string[]; _tenant_id: string }
        Returns: boolean
      }
      tomar_mesa: { Args: { _table_id: string }; Returns: Json }
      tomar_parte: {
        Args: { _parte_id: string; _qr_token: string }
        Returns: undefined
      }
      transferir_mesa: {
        Args: { _staff_id: string; _table_id: string }
        Returns: Json
      }
      trivia_vivo_mesa: { Args: { _qr_token: string }; Returns: Json }
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
      ver_activacion: { Args: { _token: string }; Returns: Json }
      ver_invitacion_mozo: {
        Args: { _token: string }
        Returns: {
          estado: string
          local: string
          rol: string
        }[]
      }
      ver_mesa: { Args: { _qr_token: string }; Returns: Json }
      ver_promo: { Args: { _token: string }; Returns: Json }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
