alter table main_switch_minute add column electrical_fields_json text not null default '{}';
alter table main_switch_minute add column field_validity_json text not null default '{}';
-- Imported archives have a user-assigned completion date, not invented start/epoch times.
alter table training_run alter column started_at drop not null;
alter table training_epoch alter column recorded_at drop not null;
