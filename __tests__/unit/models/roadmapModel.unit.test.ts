import mongoose from 'mongoose';
import { Roadmap } from '../../../src/models/roadmapModel.js';

describe('Roadmap Model Methods', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let roadmap: any;

    beforeEach(() => {
        roadmap = new Roadmap({
            userId: new mongoose.Types.ObjectId(),
            roadmapId: 'RM-123',
            startDate: new Date(),
            endDate: new Date(),
            totalWeeks: 2,
            activeWeekNumber: 1,
            weeklyFocuses: [
                {
                    weekNumber: 1,
                    dailyFocuses: [
                        {
                            dayNumber: 1,
                            status: 'pending',
                            dailySessionCompleted: false,
                            isCritical: false,
                        },
                        {
                            dayNumber: 2,
                            status: 'pending',
                            dailySessionCompleted: false,
                            isCritical: true,
                        },
                    ],
                },
            ],
        });
    });

    describe('isBlocked virtual', () => {
        it('should return false if activeWeek not found', () => {
            roadmap.activeWeekNumber = 99;
            expect(roadmap.isBlocked).toBe(false);
        });

        it('should return true if there is a critical dailyFocus that is not completed', () => {
            expect(roadmap.isBlocked).toBe(true);
        });

        it('should return false if all critical dailyFocuses are completed', () => {
            roadmap.weeklyFocuses[0].dailyFocuses[1].dailySessionCompleted = true; // Complete the critical one
            expect(roadmap.isBlocked).toBe(false);
        });
    });

    describe('blockedDailyFocus virtual', () => {
        it('should return null if activeWeek not found', () => {
            roadmap.activeWeekNumber = 99;
            expect(roadmap.blockedDailyFocus).toBeNull();
        });

        it('should return the blocked daily focus', () => {
            const blocked = roadmap.blockedDailyFocus;
            expect(blocked).toBeDefined();
            expect(blocked.isCritical).toBe(true);
            expect(blocked.dailySessionCompleted).toBe(false);
        });
    });

    describe('updateDayOfWeekFromUserPreferences', () => {
        it('should update dayOfWeek correctly based on user preferences', () => {
            roadmap.updateDayOfWeekFromUserPreferences([1, 3]);
            const daily = roadmap.weeklyFocuses[0].dailyFocuses;
            expect(daily[0].dayOfWeek).toBe(1);
            expect(daily[1].dayOfWeek).toBe(3);
        });

        it('should set dayOfWeek to 0 if index exceeds user preferences', () => {
            roadmap.updateDayOfWeekFromUserPreferences([1]);
            const daily = roadmap.weeklyFocuses[0].dailyFocuses;
            expect(daily[0].dayOfWeek).toBe(1);
            expect(daily[1].dayOfWeek).toBe(0);
        });

        it('should handle gracefully if week.dailyFocuses is missing or empty', () => {
            roadmap.weeklyFocuses.push({
                weekNumber: 2,
                dailyFocuses: [], // Empty array hits the branch
            });
            expect(() =>
                roadmap.updateDayOfWeekFromUserPreferences([1, 2])
            ).not.toThrow();
        });
    });

    describe('completeDailySession', () => {
        it('should mark daily session as completed and status as completed', () => {
            roadmap.completeDailySession(1, 1);
            const daily = roadmap.weeklyFocuses[0].dailyFocuses[0];
            expect(daily.dailySessionCompleted).toBe(true);
            expect(daily.status).toBe('completed');
        });

        it('should not throw if week or day is not found', () => {
            expect(() => roadmap.completeDailySession(2, 1)).not.toThrow();
            expect(() => roadmap.completeDailySession(1, 3)).not.toThrow();
        });
    });

    describe('checkAndUpdateActiveWeek', () => {
        it('should return false if active week is not found', () => {
            roadmap.activeWeekNumber = 99;
            expect(roadmap.checkAndUpdateActiveWeek()).toBe(false);
        });

        it('should return false if not all daily focuses are completed', () => {
            expect(roadmap.checkAndUpdateActiveWeek()).toBe(false);
        });

        it('should increment activeWeekNumber and return true if all daily focuses are completed/skipped', () => {
            roadmap.completeDailySession(1, 1);
            roadmap.weeklyFocuses[0].dailyFocuses[1].status = 'skipped';

            const result = roadmap.checkAndUpdateActiveWeek();

            expect(result).toBe(true);
            expect(roadmap.activeWeekNumber).toBe(2);
            expect(roadmap.weeklyFocuses[0].status).toBe('completed');
            expect(roadmap.lastActiveDate).toBeDefined();
        });

        it('should return false if all completed but already at max totalWeeks', () => {
            roadmap.activeWeekNumber = 2; // max is 2
            roadmap.weeklyFocuses.push({
                weekNumber: 2,
                dailyFocuses: [{ dayNumber: 1, status: 'completed' }],
            });

            const result = roadmap.checkAndUpdateActiveWeek();

            expect(result).toBe(false);
            expect(roadmap.activeWeekNumber).toBe(2); // no increment
        });
    });
});
