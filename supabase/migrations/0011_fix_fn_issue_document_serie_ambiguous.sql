-- Fix: "column reference \"serie\" is ambiguous" in fn_issue_document (emissione di una fattura).
-- La funzione restituisce TABLE(number, number_label, serie, anno): in plpgsql quei nomi diventano variabili e collidono con le colonne
-- di document_numbering nell'ON CONFLICT (tenant_id, serie, anno). Con #variable_conflict use_column i nomi di colonna hanno la precedenza.
-- Già applicata su xenora-prod il 13/10/2026 (la funzione non era in 0001-0010: era stata creata fuori repo).
CREATE OR REPLACE FUNCTION public.fn_issue_document(p_doc uuid)
 RETURNS TABLE(number integer, number_label text, serie text, anno integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  d public.documents%rowtype; v_base text; v_suffix text; v_serie text; v_anno int; v_num int; v_label text; ln record;
begin
  select * into d from public.documents where id = p_doc for update;
  if not found then raise exception 'Documento inesistente'; end if;
  if d.stato <> 'bozza' then raise exception 'Documento già emesso (stato %)', d.stato using errcode='check_violation'; end if;

  v_base := coalesce(d.structure_id, 'default');
  v_suffix := case d.doc_kind when 'nota_di_credito' then 'NC' when 'ricevuta_non_fiscale' then 'RIC' else '' end;
  v_serie := v_base || case when v_suffix <> '' then '/' || v_suffix else '' end;
  v_anno  := extract(year from coalesce(d.issue_date, current_date))::int;

  insert into public.document_numbering (tenant_id, serie, anno, last_number)
    values (d.tenant_id, v_serie, v_anno, 1)
  on conflict (tenant_id, serie, anno)
    do update set last_number = public.document_numbering.last_number + 1, updated_at = now()
  returning last_number into v_num;
  v_label := case when v_suffix <> '' then v_suffix || ' ' else '' end || v_num::text || '/' || v_anno::text;

  if d.doc_kind = 'nota_di_credito' then
    -- Storno: libera le righe folio della prenotazione (potranno essere rifatturate).
    if d.booking_id is not null then
      delete from public.invoiced_folio where tenant_id = d.tenant_id and booking_id = d.booking_id;
    end if;
  elsif d.booking_id is not null then
    for ln in select folio_ref from public.document_lines where document_id = d.id and folio_ref is not null loop
      insert into public.invoiced_folio (tenant_id, booking_id, folio_ref, document_id)
        values (d.tenant_id, d.booking_id, ln.folio_ref, d.id)
      on conflict do nothing;
    end loop;
  end if;

  update public.documents
    set stato='emessa', serie=v_serie, number=v_num, anno=v_anno, number_label=v_label, issued_at=now(),
        issue_date = coalesce(issue_date, current_date)
    where id = d.id;

  insert into public.document_events (tenant_id, document_id, kind, message, meta)
    values (d.tenant_id, d.id, 'issued', 'Documento emesso n. ' || v_label,
            jsonb_build_object('number', v_num, 'serie', v_serie, 'anno', v_anno, 'kind', d.doc_kind));

  return query select v_num, v_label, v_serie, v_anno;
end $function$;
