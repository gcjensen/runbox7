// --------- BEGIN RUNBOX LICENSE ---------
// Copyright (C) 2016-2018 Runbox Solutions AS (runbox.com).
//
// This file is part of Runbox 7.
//
// Runbox 7 is free software: You can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the
// Free Software Foundation, either version 3 of the License, or (at your
// option) any later version.
//
// Runbox 7 is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
// General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Runbox 7. If not, see <https://www.gnu.org/licenses/>.
// ---------- END RUNBOX LICENSE ----------

import * as ICAL from 'ical.js';

// same should be done for bday, documented and PR'd to https://github.com/mozilla-comm/ical.js
ICAL.design.vcard3.property.tel.defaultType = 'text';

export class StringValueWithTypes {
    types: string[];
    value: string;
}

export class GroupMember {
    scheme: string;
    value: string;

    // this will be non-null if an lookup-able URI is present
    get uuid(): string {
        return this.scheme === 'urn:uuid' ? this.value : null;
    }

    constructor(private prop: ICAL.Property) {
        const value = prop.getFirstValue();
        const splitter = value.lastIndexOf(':');
        if (splitter === -1) {
            // assume it was meant to be a UUID
            this.scheme = 'urn:uuid';
            this.value  = value;
        } else {
            this.scheme = value.substr(0, splitter);
            this.value  = value.substr(splitter + 1);
        }
    }
}

// as in https://tools.ietf.org/html/rfc6350#section-6.1.4
// 'x-name's are unsupported and treated as individuals
export enum ContactKind {
    INVIDIDUAL = 'individual',
    GROUP      = 'group',
    ORG        = 'org',
    LOCATION   = 'location',
}

// this hack allows us to pretend to have methods for enums
export namespace ContactKind {
    export function fromString(name: string): ContactKind {
        // nullable types suck >:(
        const lowerName = name ? name.toLowerCase() : null;
        const mapping = {
            'group':    ContactKind.GROUP,
            'org':      ContactKind.ORG,
            'location': ContactKind.LOCATION,
        };
        return mapping[lowerName] || ContactKind.INVIDIDUAL;
    }
}

export class AddressDetails {
    // fields as in https://tools.ietf.org/html/rfc6350#section-6.3.1
    constructor(public values: string[]) { }

    static fromDict(dict: any): AddressDetails {
        return new AddressDetails([
            dict['pobox'],
            dict['extended'],
            dict['street'],
            dict['city'],
            dict['region'],
            dict['post_code'],
            dict['country'],
        ].map(e => e || ''));
    }

    get pobox():     string { return this.values[0]; }
    get extended():  string { return this.values[1]; }
    get street():    string { return this.values[2]; }
    get city():      string { return this.values[3]; }
    get region():    string { return this.values[4]; }
    get post_code(): string { return this.values[5]; }
    get country():   string { return this.values[6]; }
}

export class Address {
    constructor(
        public types: string[],
        public value: AddressDetails,
    ) { }

    toDict() {
        return {
            types:     this.types,
            value: {
                pobox:     this.value.pobox,
                extended:  this.value.extended,
                street:    this.value.street,
                city:      this.value.city,
                region:    this.value.region,
                post_code: this.value.post_code,
                country:   this.value.country,
            }
        };
    }
}

export class Contact {
    component: ICAL.Component;
    url:       string;

    // may throw ICAL.ParserError if input is not a valid vcf
    static fromVcf(vcf: string): Contact[] {
        let cards = ICAL.parse(vcf);
        if (cards[0] === 'vcard') {
            cards = [cards];
        }
        return cards.map((jcard: any) => {
            if (jcard[0] !== 'vcard') {
                throw new Error('File does not seem to contain vcards');
            }
            const contact = new Contact({});
            contact.component = new ICAL.Component(jcard);
            return contact;
        });
    }

    static fromVcard(url: string, vcard: string): Contact {
        const contact = new Contact({});
        contact.component = ICAL.Component.fromString(vcard);
        contact.url = url;
        return contact;
    }

    private getIndexedValue(name: string, index: number): string {
        const value = this.component.getFirstPropertyValue(name);
        if (value) {
            return value[index];
        } else {
            return null;
        }
    }

    private setIndexedValue(name: string, index: number, value: string) {
        let prop = this.component.getFirstProperty(name);
        let values: string[];
        if (prop) {
            // We need this weird dance since getValues() returns
            // an array of values wrapped in an array anyway.
            const propValue = prop.getValues();
            if (!propValue) {
                values = [];
            } else {
                values = propValue[0];
            }
        } else {
            prop = new ICAL.Property(name, this.component);
            this.component.addProperty(prop);
            values = [];
        }
        values[index] = value;
        // need to fix up the empty spots,
        // otherwise ICAL.js will crap itself
        for (let i = 0; i < index; i++) {
            if (values[i] === undefined) {
                values[i] = '';
            }
        }
        prop.setValue(values);
    }

    private getMultiValProp(name: string): string[] {
        const prop = this.component.getFirstProperty(name);
        return prop ? prop.getValues() : [];
    }

    private setMultiValProp(name: string, values: string[]) {
        if (this.component.hasProperty(name)) {
            this.component.removeAllProperties(name);
        }
        if (values.length > 0) {
            const prop = new ICAL.Property(name, this.component);
            prop.setValues(values);
            this.component.addProperty(prop);
        }
    }

    private setMultiValPropWithTypes(name: string, values: StringValueWithTypes[]) {
        if (this.component.hasProperty(name)) {
            this.component.removeAllProperties(name);
        }
        for (const e of values) {
            const prop = this.component.addPropertyWithValue(name, e.value);
            if (e.types.length > 0) {
                prop.setParameter('type', e.types);
            }
        }
    }

    private getPropertyTypes(p: ICAL.Property): string[] {
        let types = p.getParameter('type');
        if (types === undefined) {
            types = [];
        } else if (typeof types === 'string') {
            types = [types];
        }
        return types;
    }

    private normalizeStringProperty(p: ICAL.Property): StringValueWithTypes {
        return {
            types: this.getPropertyTypes(p),
            value: p.getFirstValue(),
        };
    }

    private multiplePropertiesNormalized(name: string): StringValueWithTypes[] {
        const props = this.component.getAllProperties(name);
        if (props) {
            return props.map((e: ICAL.Property) => this.normalizeStringProperty(e));
        } else {
            return [];
        }
    }

    private setPropertyValue(name: string, value: string) {
        const prop = this.component.getFirstProperty(name);
        if (prop) {
            prop.setValue(value);
        } else {
            this.component.addPropertyWithValue(name, value);
        }
    }

    // always returns lowercase to make comparisons easier
    get id(): string {
        const uid = this.component.getFirstPropertyValue('uid');
        return uid ? uid.toLowerCase() : null;
    }

    set id(value: string) {
        this.setPropertyValue('uid', value);
    }

    get full_name(): string {
        return this.component.getFirstPropertyValue('fn');
    }

    set full_name(value: string) {
        this.setPropertyValue('fn', value);
    }

    get nickname(): string {
        return this.component.getFirstPropertyValue('nickname');
    }

    set nickname(value: string) {
        this.setPropertyValue('nickname', value);
    }

    get first_name(): string {
        return this.getIndexedValue('n', 1);
    }

    set first_name(value: string) {
        this.setIndexedValue('n', 1, value);
    }

    get last_name(): string {
        return this.getIndexedValue('n', 0);
    }

    set last_name(value: string) {
        this.setIndexedValue('n', 0, value);
    }

    get categories(): string[] {
        return this.getMultiValProp('categories');
    }

    set categories(value: string[]) {
        this.setMultiValProp('categories', value);
    }

    get kind(): ContactKind {
        return ContactKind.fromString(
            this.component.getFirstPropertyValue('kind')
            || this.component.getFirstPropertyValue('x-addressbookserver-kind')
        );
    }

    set kind(k: ContactKind) {
        this.component.updatePropertyWithValue('kind', k.toString());
    }

    get company(): string {
        const org = this.component.getFirstPropertyValue('org');
        // Some vCard emiters (like Nextcloud) will store this as a string
        // rather than an array that it should be.
        if (Array.isArray(org)) {
            return org[0];
        } else {
            return org;
        }
    }

    set company(value: string) {
        this.setIndexedValue('org', 0, value);
    }

    get department(): string {
        return this.getIndexedValue('org', 1);
    }

    set department(value: string) {
        this.setIndexedValue('org', 1, value);
    }

    get birthday(): string {
        // ICAL.js is bad at parsing this,
        // ignores VALUE=text and assumes it's a date
        const prop = this.component.getFirstProperty('bday');
        if (prop) {
            return prop.toJSON()[3];
        }
    }

    set birthday(value: string) {
        this.setPropertyValue('bday', value);
    }

    get note(): string {
        return this.component.getFirstPropertyValue('note');
    }

    set note(value: string) {
        this.setPropertyValue('note', value);
    }

    get emails(): StringValueWithTypes[] {
        return this.multiplePropertiesNormalized('email');
    }

    set emails(emails: StringValueWithTypes[]) {
        this.setMultiValPropWithTypes('email', emails);
    }

    get phones(): StringValueWithTypes[] {
        return this.multiplePropertiesNormalized('tel');
    }

    set phones(phones: StringValueWithTypes[]) {
        this.setMultiValPropWithTypes('tel', phones);
    }

    get urls(): StringValueWithTypes[] {
        return this.multiplePropertiesNormalized('url');
    }

    set urls(urls: StringValueWithTypes[]) {
        this.setMultiValPropWithTypes('url', urls);
    }

    get addresses(): Address[] {
        const props = this.component.getAllProperties('adr');
        if (props) {
            return props.map((p: ICAL.Property) => {
                return new Address(
                    this.getPropertyTypes(p),
                    new AddressDetails(p.getFirstValue()),
                );
            });
        } else {
            return [];
        }
    }

    set addresses(values: Address[]) {
        if (this.component.hasProperty('adr')) {
            this.component.removeAllProperties('adr');
        }
        for (const e of values) {
            const prop = this.component.addPropertyWithValue('adr', e.value.values);
            if (e.types.length > 0) {
                prop.setParameter('type', e.types);
            }
        }
    }

    get related(): StringValueWithTypes[] {
        return this.multiplePropertiesNormalized('related');
    }

    set related(related: StringValueWithTypes[]) {
        this.setMultiValPropWithTypes('related', related);
    }

    get members(): GroupMember[] {
        const props = this.component.getAllProperties('member');
        if (props) {
            return props.map((p: ICAL.Property) => new GroupMember(p));
        } else {
            return [];
        }
    }

    toDict(): any {
        return {
            full_name:  this.full_name,
            nickname:   this.nickname,
            first_name: this.first_name,
            last_name:  this.last_name,
            categories: this.categories,
            company:    this.company,
            department: this.department,
            birthday:   this.birthday,
            note:       this.note,
            emails:     this.emails,
            phones:     this.phones,
            urls:       this.urls,
            addresses:  this.addresses.map(a => a.toDict()),
            related:    this.related,
        };
    }

    vcard(): string {
        if (!this.component.getFirstPropertyValue('fn')) {
            let fn: string;
            if (this.nickname) {
                fn = this.nickname;
            } else if (this.first_name || this.last_name) {
                fn = [this.first_name, this.last_name].join(' ');
            } else if (this.company) {
                fn = this.company;
                this.component.setPropertyValue('X-ABSHOWAS', 'COMPANY');
            } else if (this.primary_email()) {
                fn = this.primary_email();
            } else {
                throw new Error("Can't deduce a fullname for contact");
            }
            this.setPropertyValue('fn', fn);
        }

        return this.component.toString();
    }

    constructor(properties: any) {
        this.component = new ICAL.Component('vcard');

        if (properties['email']) {
            properties['emails'] = [
                { 'types': ['home'], 'value': properties['email'] }
            ];
            delete properties['email'];
        }

        // tslint:disable-next-line:forin
        for (const key in properties) {
            if (properties[key] !== null && properties[key] !== '') {
                this[key] = properties[key];
            }
        }

        // if the contact contains fullname (FN) but not any other names,
        // rewrite the FN into the nickname
        if (!this.nickname && !this.first_name && !this.last_name && properties['fullname']) {
            this.nickname = properties['fullname'];
        }
    }

    display_name(): string|null {
        if (this.show_as_company()) {
            return this.company;
        }

        if (this.nickname) {
            const fn = this.first_and_last_name();
            const postfix = fn ?  (' (' + fn + ')') : '';
            return this.nickname + postfix;
        }

        return this.first_and_last_name() || this.full_name;
    }

    first_and_last_name(): string {
        if (this.first_name && this.last_name) {
            return this.first_name + ' ' + this.last_name;
        } else if (this.first_name) {
            return this.first_name;
        } else {
            return this.last_name;
        }
    }

    external_display_name(): string {
        if (this.first_and_last_name()) {
            return this.first_and_last_name();
        }
        if (this.primary_email()) {
            const parts = this.primary_email().split('@');
            return parts[0];
        }
        return 'Unnamed contact';
    }

    primary_email(): string {
        if (this.emails.length > 0) {
            return this.emails[0].value;
        }
        return null;
    }

    show_as_company(): boolean {
        if (this.component.hasProperty('x-abshowas')) {
            return this.component.getFirstPropertyValue('x-abshowas') === 'COMPANY';
        }

        return this.kind === ContactKind.ORG;
    }
}
