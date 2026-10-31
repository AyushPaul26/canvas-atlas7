import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {courseRecordSchema,learningPlanSchema,initialLearningProgress,type CourseRecord,type CourseLesson,type LearningPlan} from '@living-canvas/protocol'
import {checkDatabaseVersion,databaseTransaction} from './database'
import {DocumentRepository} from './document-repository'

export class CourseRepository {
  constructor(readonly db:DatabaseSync){checkDatabaseVersion(db)}
  createCourse(input:LearningPlan,documentIds:string[],lessons:CourseLesson[]=[]):CourseRecord {
    const plan=learningPlanSchema.parse(input),now=new Date().toISOString()
    const course:CourseRecord={id:randomUUID(),title:plan.title,plan,documentIds,sessionIds:[],lessons,progress:initialLearningProgress(plan),createdAt:now,updatedAt:now}
    this.saveCourse(course);return this.loadCourse(course.id)!
  }
  saveCourse(input:CourseRecord):void{
    const course=courseRecordSchema.parse(input)
    databaseTransaction(this.db,()=>{
      const documents=new DocumentRepository(this.db)
      for(const id of course.documentIds)if(!documents.loadDocument(id))throw new Error('Course references an unknown document.')
      for(const concept of course.plan.concepts)for(const ref of concept.sourceRefs)documents.assertSourceRef(ref)
      for(const lesson of course.lessons??[])for(const ref of lesson.sourceRefs)documents.assertSourceRef(ref)
      for(const sessionId of course.sessionIds)if(!this.db.prepare('SELECT id FROM sessions WHERE id=?').get(sessionId))throw new Error('Course references an unknown lesson session.')
      const storedPlan=this.db.prepare('SELECT payload FROM learning_plans WHERE id=? AND version=?').get(course.plan.id,course.plan.version) as {payload:string}|undefined
      if(storedPlan&&storedPlan.payload!==JSON.stringify(course.plan))throw new Error('An accepted learning plan version is immutable.')
      this.db.prepare('INSERT OR IGNORE INTO learning_plans(id,version,payload) VALUES(?,?,?)').run(course.plan.id,course.plan.version,JSON.stringify(course.plan))
      this.db.prepare('INSERT INTO courses(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(course.id,JSON.stringify(course))
      this.db.prepare('DELETE FROM course_sessions WHERE course_id=?').run(course.id)
      for(const sessionId of course.sessionIds)this.db.prepare('INSERT INTO course_sessions VALUES(?,?)').run(course.id,sessionId)
    })
  }
  loadCourse(id:string):CourseRecord|undefined{
    checkDatabaseVersion(this.db);const row=this.db.prepare('SELECT payload FROM courses WHERE id=?').get(id) as {payload:string}|undefined
    if(!row)return undefined
    const course=courseRecordSchema.parse(JSON.parse(row.payload)),sessionIds=(this.db.prepare('SELECT session_id FROM course_sessions WHERE course_id=? ORDER BY rowid').all(id) as {session_id:string}[]).map(row=>row.session_id)
    // Cascaded session deletion must not leave dead links in the returned record.
    return {...course,sessionIds,lessons:course.lessons?.map(lesson=>lesson.sessionId&&!sessionIds.includes(lesson.sessionId)?{...lesson,sessionId:undefined}:lesson)}
  }
  listCourses():CourseRecord[]{checkDatabaseVersion(this.db);return (this.db.prepare('SELECT id FROM courses ORDER BY rowid DESC').all() as {id:string}[]).map(row=>this.loadCourse(row.id)!)}
  linkSession(courseId:string,sessionId:string,lessonId?:string):CourseRecord{
    return databaseTransaction(this.db,()=>{
      const course=this.loadCourse(courseId);if(!course)throw new Error('This course was not found.')
      if(lessonId&&!course.lessons?.some(lesson=>lesson.id===lessonId))throw new Error('This course lesson was not found.')
      if(!course.sessionIds.includes(sessionId))course.sessionIds.push(sessionId)
      if(lessonId)course.lessons=course.lessons?.map(lesson=>lesson.id===lessonId?{...lesson,sessionId}:lesson)
      course.updatedAt=new Date().toISOString();this.saveCourse(course);return this.loadCourse(courseId)!
    })
  }
}
