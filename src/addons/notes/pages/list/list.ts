// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { CoreConstants } from '@/core/constants';
import { AddonNotesAddComponent, AddonNotesAddModalReturn } from '@addons/notes/components/add/add-modal';
import { AddonNotes, AddonNotesNoteFormatted, AddonNotesPublishState } from '@addons/notes/services/notes';
import { AddonNotesOffline } from '@addons/notes/services/notes-offline';
import { AddonNotesSync, AddonNotesSyncProvider } from '@addons/notes/services/notes-sync';
import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CoreAnimations } from '@components/animations';
import { CoreUser, CoreUserProfile } from '@features/user/services/user';
import { IonContent, IonRefresher } from '@ionic/angular';
import { CoreNavigator } from '@services/navigator';
import { CoreSites } from '@services/sites';
import { CoreDomUtils, ToastDuration } from '@services/utils/dom';
import { CoreTextUtils } from '@services/utils/text';
import { CoreUtils } from '@services/utils/utils';
import { CoreEventObserver, CoreEvents } from '@singletons/events';

/**
 * Page that displays a list of notes.
 */
@Component({
    selector: 'page-addon-notes-list-page',
    templateUrl: 'list.html',
    animations: [CoreAnimations.SLIDE_IN_OUT],
})
export class AddonNotesListPage implements OnInit, OnDestroy {

     @ViewChild(IonContent) content?: IonContent;

    courseId!: number;
    userId?: number;
    type: AddonNotesPublishState = 'course';
    refreshIcon = CoreConstants.ICON_LOADING;
    syncIcon = CoreConstants.ICON_LOADING;
    notes: AddonNotesNoteFormatted[] = [];
    hasOffline = false;
    notesLoaded = false;
    user?: CoreUserProfile;
    showDelete = false;
    canDeleteNotes = false;
    currentUserId!: number;

    protected syncObserver!: CoreEventObserver;
    protected logAfterFetch = true;

    constructor() {
        try {
            this.courseId = CoreNavigator.getRequiredRouteNumberParam('courseId');
            this.userId = CoreNavigator.getRouteNumberParam('userId');
        } catch (error) {
            CoreDomUtils.showErrorModal(error);

            CoreNavigator.back();

            return;
        }

        // Refresh data if notes are synchronized automatically.
        this.syncObserver = CoreEvents.on(AddonNotesSyncProvider.AUTO_SYNCED, (data) => {
            if (data.courseId == this.courseId) {
                // Show the sync warnings.
                this.showSyncWarnings(data.warnings);

                // Refresh the data.
                this.notesLoaded = false;
                this.refreshIcon = CoreConstants.ICON_LOADING;
                this.syncIcon = CoreConstants.ICON_LOADING;

                this.content?.scrollToTop();
                this.fetchNotes(false);
            }
        }, CoreSites.getCurrentSiteId());

        this.currentUserId = CoreSites.getCurrentSiteUserId();
    }

    /**
     * @inheritdoc
     */
    async ngOnInit(): Promise<void> {
        await this.fetchNotes(true);
    }

    /**
     * Fetch notes.
     *
     * @param sync When to resync notes.
     * @param showSyncErrors When to display sync errors or not.
     * @returns Promise with the notes.
     */
    protected async fetchNotes(sync = false, showSyncErrors = false): Promise<void> {
        if (sync) {
            await this.syncNotes(showSyncErrors);
        }

        try {
            const allNotes = await AddonNotes.getNotes(this.courseId, this.userId);

            const notesList: AddonNotesNoteFormatted[] = allNotes[this.type + 'notes'] || [];

            notesList.forEach((note) => {
                note.content = CoreTextUtils.decodeHTML(note.content);
            });

            await AddonNotes.setOfflineDeletedNotes(notesList, this.courseId);

            this.hasOffline = notesList.some((note) => note.offline || note.deleted);

            if (this.userId) {
                this.notes = notesList;

                // Get the user profile to retrieve the user image.
                this.user = await CoreUser.getProfile(this.userId, this.courseId, true);
            } else {
                this.notes = await AddonNotes.getNotesUserData(notesList);
            }

            if (this.logAfterFetch) {
                this.logAfterFetch = false;
                CoreUtils.ignoreErrors(AddonNotes.logView(this.courseId, this.userId));
            }
        } catch (error) {
            CoreDomUtils.showErrorModal(error);
        } finally {
            let canDelete = this.notes && this.notes.length > 0;
            if (canDelete && this.type == 'personal') {
                canDelete = !!this.notes.find((note) => note.usermodified == this.currentUserId);
            }
            this.canDeleteNotes = canDelete;

            this.notesLoaded = true;
            this.refreshIcon = CoreConstants.ICON_REFRESH;
            this.syncIcon = CoreConstants.ICON_SYNC;
        }
    }

    /**
     * Refresh notes on PTR.
     *
     * @param showSyncErrors Whether to display sync errors or not.
     * @param refresher Refresher instance.
     */
    refreshNotes(showSyncErrors: boolean, refresher?: IonRefresher): void {
        this.refreshIcon = CoreConstants.ICON_LOADING;
        this.syncIcon = CoreConstants.ICON_LOADING;

        AddonNotes.invalidateNotes(this.courseId, this.userId).finally(() => {
            this.fetchNotes(true, showSyncErrors).finally(() => {
                if (refresher) {
                    refresher?.complete();
                }
            });
        });
    }

    /**
     * Function called when the type has changed.
     *
     * @param type New type.
     */
    async typeChanged(type: AddonNotesPublishState): Promise<void> {
        this.type = type;
        this.notesLoaded = false;
        this.refreshIcon = CoreConstants.ICON_LOADING;
        this.syncIcon = CoreConstants.ICON_LOADING;
        this.logAfterFetch = true;

        await this.fetchNotes(true);
    }

    /**
     * Add a new Note to user and course.
     *
     * @param e Event.
     */
    async addNote(e: Event): Promise<void> {
        e.preventDefault();
        e.stopPropagation();

        const modalData = await CoreDomUtils.openModal<AddonNotesAddModalReturn>({
            component: AddonNotesAddComponent,
            componentProps: {
                userId: this.userId,
                courseId: this.courseId,
                type: this.type,
            },
        });

        if (modalData !== undefined) {

            if (modalData.sent && modalData.type) {
                if (modalData.type != this.type) {
                    this.type = modalData.type;
                    this.notesLoaded = false;
                }

                this.refreshNotes(false);
            } else if (modalData.type && modalData.type != this.type) {
                this.typeChanged(modalData.type);
            }
        }
    }

    /**
     * Delete a note.
     *
     * @param e Click event.
     * @param note Note to delete.
     */
    async deleteNote(e: Event, note: AddonNotesNoteFormatted): Promise<void> {
        e.preventDefault();
        e.stopPropagation();

        try {
            await CoreDomUtils.showDeleteConfirm('addon.notes.deleteconfirm');
            try {
                await AddonNotes.deleteNote(note, this.courseId);
                this.showDelete = false;

                this.refreshNotes(false);

                CoreDomUtils.showToast('addon.notes.eventnotedeleted', true, ToastDuration.LONG);

            } catch (error) {
                CoreDomUtils.showErrorModalDefault(error, 'Delete note failed.');
            }
        } catch {
            // User cancelled, nothing to do.
        }
    }

    /**
     * Restore a note.
     *
     * @param e Click event.
     * @param note Note to delete.
     */
    async undoDeleteNote(e: Event, note: AddonNotesNoteFormatted): Promise<void> {
        e.preventDefault();
        e.stopPropagation();

        await AddonNotesOffline.undoDeleteNote(note.id);
        this.refreshNotes(false);
    }

    /**
     * Toggle delete.
     */
    toggleDelete(): void {
        this.showDelete = !this.showDelete;
    }

    /**
     * Tries to synchronize course notes.
     *
     * @param showSyncErrors Whether to display sync errors or not.
     * @returns Promise resolved when done.
     */
    protected async syncNotes(showSyncErrors: boolean): Promise<void> {
        try {
            const result = await AddonNotesSync.syncNotes(this.courseId);

            this.showSyncWarnings(result.warnings);
        } catch (error) {
            if (showSyncErrors) {
                CoreDomUtils.showErrorModalDefault(error, 'core.errorsync', true);
            }
        }
    }

    /**
     * Show sync warnings if any.
     *
     * @param warnings the warnings
     */
    protected showSyncWarnings(warnings: string[]): void {
        const message = CoreTextUtils.buildMessage(warnings);

        if (message) {
            CoreDomUtils.showAlert(undefined, message);
        }
    }

    /**
     * Page destroyed.
     */
    ngOnDestroy(): void {
        this.syncObserver && this.syncObserver.off();
    }

}
